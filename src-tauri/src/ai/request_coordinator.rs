use std::{
    collections::HashMap,
    sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RequestClass {
    Interactive,
    Summary,
}

#[derive(Default)]
struct LaneState {
    active: bool,
    waiting_interactive: usize,
}

#[derive(Default)]
struct CoordinatorState {
    lanes: HashMap<String, LaneState>,
}

#[derive(Default)]
struct CoordinatorInner {
    state: Mutex<CoordinatorState>,
    changed: Condvar,
}

#[derive(Clone, Default)]
pub(crate) struct RequestCoordinator {
    inner: Arc<CoordinatorInner>,
}

impl RequestCoordinator {
    pub(crate) fn acquire_interactive_cancellable<E>(
        &self,
        lane: impl Into<String>,
        cancelled: impl FnMut() -> Result<bool, E>,
    ) -> Result<Option<RequestPermit>, E> {
        self.acquire_cancellable(lane.into(), RequestClass::Interactive, cancelled)
    }

    pub(crate) fn acquire_summary_cancellable<E>(
        &self,
        lane: impl Into<String>,
        cancelled: impl FnMut() -> Result<bool, E>,
    ) -> Result<Option<RequestPermit>, E> {
        self.acquire_cancellable(lane.into(), RequestClass::Summary, cancelled)
    }

    #[cfg(test)]
    fn acquire_interactive(&self, lane: impl Into<String>) -> RequestPermit {
        self.acquire(lane.into(), RequestClass::Interactive)
    }

    #[cfg(test)]
    fn acquire_summary(&self, lane: impl Into<String>) -> RequestPermit {
        self.acquire(lane.into(), RequestClass::Summary)
    }

    #[cfg(test)]
    fn acquire(&self, lane: String, class: RequestClass) -> RequestPermit {
        self.acquire_cancellable(lane, class, || Ok::<_, std::convert::Infallible>(false))
            .unwrap()
            .expect("uncancellable request always receives a permit")
    }

    fn acquire_cancellable<E>(
        &self,
        lane: String,
        class: RequestClass,
        mut cancelled: impl FnMut() -> Result<bool, E>,
    ) -> Result<Option<RequestPermit>, E> {
        let mut state = lock_state(&self.inner);
        if class == RequestClass::Interactive {
            state
                .lanes
                .entry(lane.clone())
                .or_default()
                .waiting_interactive += 1;
        }
        loop {
            match cancelled() {
                Ok(false) => {}
                stopped => {
                    if let Some(waiting) = state.lanes.get_mut(&lane) {
                        if class == RequestClass::Interactive {
                            waiting.waiting_interactive -= 1;
                        }
                        if !waiting.active && waiting.waiting_interactive == 0 {
                            state.lanes.remove(&lane);
                        }
                    }
                    self.inner.changed.notify_all();
                    return stopped.map(|_| None);
                }
            }
            let lane_state = state.lanes.entry(lane.clone()).or_default();
            let can_start = !lane_state.active
                && (class == RequestClass::Interactive || lane_state.waiting_interactive == 0);
            if can_start {
                lane_state.active = true;
                if class == RequestClass::Interactive {
                    lane_state.waiting_interactive -= 1;
                }
                return Ok(Some(RequestPermit {
                    inner: self.inner.clone(),
                    lane,
                }));
            }
            state = self
                .inner
                .changed
                .wait_timeout(state, std::time::Duration::from_millis(50))
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
        }
    }

    #[cfg(test)]
    fn waiting_interactive(&self, lane: &str) -> usize {
        lock_state(&self.inner)
            .lanes
            .get(lane)
            .map(|state| state.waiting_interactive)
            .unwrap_or_default()
    }
}

pub(crate) struct RequestPermit {
    inner: Arc<CoordinatorInner>,
    lane: String,
}

impl Drop for RequestPermit {
    fn drop(&mut self) {
        let mut state = lock_state(&self.inner);
        if let Some(lane_state) = state.lanes.get_mut(&self.lane) {
            lane_state.active = false;
            if lane_state.waiting_interactive == 0 {
                state.lanes.remove(&self.lane);
            }
        }
        self.inner.changed.notify_all();
    }
}

fn lock_state(inner: &CoordinatorInner) -> MutexGuard<'_, CoordinatorState> {
    inner
        .state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn global_request_coordinator() -> &'static RequestCoordinator {
    static COORDINATOR: OnceLock<RequestCoordinator> = OnceLock::new();
    COORDINATOR.get_or_init(RequestCoordinator::default)
}

pub(crate) fn acquire_interactive<E>(
    lane: &str,
    mut check: impl FnMut() -> Result<(), E>,
) -> Result<RequestPermit, E> {
    global_request_coordinator()
        .acquire_interactive_cancellable(lane, || check().map(|_| false))
        .map(|permit| permit.expect("check returns an error when cancelled"))
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{Arc, mpsc},
        thread,
        time::Duration,
    };

    use super::*;

    #[test]
    fn cancellation_releases_a_waiting_request_before_the_active_request_finishes() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let coordinator = RequestCoordinator::default();
        let first = coordinator.acquire_summary("service");
        let cancelled = Arc::new(AtomicBool::new(false));
        let worker_cancelled = cancelled.clone();
        let worker_coordinator = coordinator.clone();
        let (sent, received) = mpsc::channel();
        let worker = thread::spawn(move || {
            let result = worker_coordinator.acquire_interactive_cancellable("service", || {
                Ok::<_, ()>(worker_cancelled.load(Ordering::Acquire))
            });
            sent.send(result.unwrap().is_none()).unwrap();
        });
        while coordinator.waiting_interactive("service") == 0 {
            thread::yield_now();
        }
        cancelled.store(true, Ordering::Release);
        let stopped_before_release = received.recv_timeout(Duration::from_millis(500));
        drop(first);
        worker.join().unwrap();
        assert_eq!(stopped_before_release, Ok(true));
        assert_eq!(coordinator.waiting_interactive("service"), 0);
    }

    #[test]
    fn interactive_request_runs_before_the_next_summary_chunk() {
        let coordinator = Arc::new(RequestCoordinator::default());
        let first_summary = coordinator.acquire_summary("service-a");
        let (events_tx, events_rx) = mpsc::channel();

        let interactive_coordinator = coordinator.clone();
        let interactive_events = events_tx.clone();
        let interactive = thread::spawn(move || {
            let permit = interactive_coordinator.acquire_interactive("service-a");
            interactive_events.send("interactive").unwrap();
            drop(permit);
        });
        while coordinator.waiting_interactive("service-a") == 0 {
            thread::yield_now();
        }

        let summary_coordinator = coordinator.clone();
        let summary_events = events_tx.clone();
        let second_summary = thread::spawn(move || {
            let permit = summary_coordinator.acquire_summary("service-a");
            summary_events.send("summary").unwrap();
            drop(permit);
        });
        assert!(events_rx.recv_timeout(Duration::from_millis(30)).is_err());
        drop(first_summary);
        assert_eq!(
            events_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            "interactive"
        );
        assert_eq!(
            events_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            "summary"
        );
        interactive.join().unwrap();
        second_summary.join().unwrap();
    }

    #[test]
    fn different_services_can_progress_independently() {
        let coordinator = RequestCoordinator::default();
        let _first = coordinator.acquire_summary("service-a");
        let _second = coordinator.acquire_summary("service-b");
    }
}
