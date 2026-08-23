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
    pub(crate) fn acquire_interactive(&self, lane: impl Into<String>) -> RequestPermit {
        self.acquire(lane.into(), RequestClass::Interactive)
    }

    #[allow(dead_code)] // Used by the chunk executor introduced in Phase 5.
    pub(crate) fn acquire_summary(&self, lane: impl Into<String>) -> RequestPermit {
        self.acquire(lane.into(), RequestClass::Summary)
    }

    fn acquire(&self, lane: String, class: RequestClass) -> RequestPermit {
        let mut state = lock_state(&self.inner);
        if class == RequestClass::Interactive {
            state
                .lanes
                .entry(lane.clone())
                .or_default()
                .waiting_interactive += 1;
        }
        loop {
            let lane_state = state.lanes.entry(lane.clone()).or_default();
            let can_start = !lane_state.active
                && (class == RequestClass::Interactive || lane_state.waiting_interactive == 0);
            if can_start {
                lane_state.active = true;
                if class == RequestClass::Interactive {
                    lane_state.waiting_interactive -= 1;
                }
                return RequestPermit {
                    inner: self.inner.clone(),
                    lane,
                };
            }
            state = self
                .inner
                .changed
                .wait(state)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
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

pub(crate) fn acquire_interactive(lane: &str) -> RequestPermit {
    global_request_coordinator().acquire_interactive(lane)
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
