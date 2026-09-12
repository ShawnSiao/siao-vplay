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
    waiting_summary: usize,
    interactive_burst: usize,
}

#[derive(Default)]
struct CoordinatorState {
    lanes: HashMap<String, LaneState>,
}

struct CoordinatorInner {
    state: Mutex<CoordinatorState>,
    changed: Condvar,
    policy: SchedulingPolicy,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SchedulingPolicy {
    schema_version: u32,
    max_interactive_burst: usize,
}
impl SchedulingPolicy {
    fn parse(source: &str) -> Result<Self, String> {
        let policy: Self = serde_json::from_str(source).map_err(|error| error.to_string())?;
        if policy.schema_version != 1 || !(1..=16).contains(&policy.max_interactive_burst) {
            return Err("unsupported AI scheduling policy".into());
        }
        Ok(policy)
    }
}
impl Default for CoordinatorInner {
    fn default() -> Self {
        Self { state: Mutex::default(), changed: Condvar::new(),
            policy: SchedulingPolicy::parse(include_str!("scheduling-policy.json"))
                .expect("bundled AI scheduling policy must be valid") }
    }
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
        } else {
            state.lanes.entry(lane.clone()).or_default().waiting_summary += 1;
        }
        loop {
            match cancelled() {
                Ok(false) => {}
                stopped => {
                    if let Some(waiting) = state.lanes.get_mut(&lane) {
                        if class == RequestClass::Interactive {
                            waiting.waiting_interactive -= 1;
                        } else {
                            waiting.waiting_summary -= 1;
                            if waiting.waiting_summary == 0 { waiting.interactive_burst = 0; }
                        }
                        if !waiting.active && waiting.waiting_interactive == 0 && waiting.waiting_summary == 0 {
                            state.lanes.remove(&lane);
                        }
                    }
                    self.inner.changed.notify_all();
                    return stopped.map(|_| None);
                }
            }
            let lane_state = state.lanes.entry(lane.clone()).or_default();
            let summary_turn = lane_state.waiting_summary > 0 &&
                lane_state.interactive_burst >= self.inner.policy.max_interactive_burst;
            let can_start = !lane_state.active && match class {
                RequestClass::Interactive => !summary_turn,
                RequestClass::Summary => lane_state.waiting_interactive == 0 || summary_turn,
            };
            if can_start {
                lane_state.active = true;
                if class == RequestClass::Interactive {
                    lane_state.waiting_interactive -= 1;
                    lane_state.interactive_burst = if lane_state.waiting_summary > 0 {
                        lane_state.interactive_burst.saturating_add(1)
                    } else { 0 };
                } else {
                    lane_state.waiting_summary -= 1;
                    lane_state.interactive_burst = 0;
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
            if lane_state.waiting_interactive == 0 && lane_state.waiting_summary == 0 {
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
    fn scheduling_policy_is_versioned_and_bounded() {
        assert_eq!(SchedulingPolicy::parse(include_str!("scheduling-policy.json")).unwrap().max_interactive_burst, 4);
        for source in [r#"{"schemaVersion":2,"maxInteractiveBurst":4}"#,
            r#"{"schemaVersion":1,"maxInteractiveBurst":0}"#,
            r#"{"schemaVersion":1,"maxInteractiveBurst":17}"#,
            r#"{"maxInteractiveBurst":4}"#,
            r#"{"schemaVersion":1,"maxInteractiveBurst":4,"unused":true}"#] {
            assert!(SchedulingPolicy::parse(source).is_err());
        }
    }

    #[test]
    fn cancelled_summary_releases_its_waiting_turn() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let coordinator = RequestCoordinator::default();
        let active = coordinator.acquire_interactive("service");
        let cancelled = Arc::new(AtomicBool::new(false));
        let flag = cancelled.clone();
        let next = coordinator.clone();
        let worker = thread::spawn(move || next.acquire_summary_cancellable("service", ||
            Ok::<_, ()>(flag.load(Ordering::Acquire))).unwrap().is_none());
        loop {
            if lock_state(&coordinator.inner).lanes["service"].waiting_summary == 1 { break; }
            thread::yield_now();
        }
        cancelled.store(true, Ordering::Release);
        assert!(worker.join().unwrap());
        assert_eq!(lock_state(&coordinator.inner).lanes["service"].waiting_summary, 0);
        drop(active);
        let _next = coordinator.acquire_interactive("service");
    }

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

    #[test]
    fn queued_summary_gets_a_turn_during_an_interactive_burst() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let coordinator = RequestCoordinator::default();
        let active = coordinator.acquire_summary("service");
        let (send, receive) = mpsc::channel();
        let mut workers = Vec::new();
        for _ in 0..8 {
            let coordinator = coordinator.clone();
            let send = send.clone();
            workers.push(thread::spawn(move || {
                let _permit = coordinator.acquire_interactive("service");
                send.send("interactive").unwrap();
            }));
        }
        while coordinator.waiting_interactive("service") != 8 { thread::yield_now(); }
        let entered = Arc::new(AtomicBool::new(false));
        let waiting = entered.clone();
        let next = coordinator.clone();
        workers.push(thread::spawn(move || {
            let _permit = next.acquire_summary_cancellable("service", || {
                waiting.store(true, Ordering::Release);
                Ok::<_, ()>(false)
            }).unwrap().unwrap();
            send.send("summary").unwrap();
        }));
        while !entered.load(Ordering::Acquire) { thread::yield_now(); }
        drop(active);
        let events: Vec<_> = (0..9).map(|_| receive.recv_timeout(Duration::from_secs(2)).unwrap()).collect();
        for worker in workers { worker.join().unwrap(); }
        assert!(events.iter().position(|event| *event == "summary").unwrap() <= 4,
            "a waiting summary must run within a bounded interactive burst: {events:?}");
    }
}
