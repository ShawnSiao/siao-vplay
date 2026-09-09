use serde::Deserialize;
use std::{
    collections::VecDeque,
    io,
    sync::{Arc, Condvar, Mutex, OnceLock},
    time::Duration,
};

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Policy {
    active_heavy: usize,
    queued_heavy: usize,
    cancellation_poll_ms: u64,
}
impl Policy {
    fn parse(json: &str) -> io::Result<Self> {
        let value: Self = serde_json::from_str(json).map_err(io::Error::other)?;
        if !(1..=4).contains(&value.active_heavy)
            || value.queued_heavy > 128
            || !(5..=250).contains(&value.cancellation_poll_ms)
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "后台任务并发配置无效",
            ));
        }
        Ok(value)
    }
}
#[derive(Clone, Copy, Debug)]
pub(crate) enum Kind {
    Transcription,
    SubtitleBurn,
    PlaybackProxy,
}
#[derive(Default)]
struct State {
    active: usize,
    next_ticket: u64,
    waiting: VecDeque<u64>,
}
struct Budget {
    policy: Policy,
    state: Mutex<State>,
    changed: Condvar,
}
pub(crate) struct Permit {
    budget: Arc<Budget>,
}
impl Budget {
    fn new(policy: Policy) -> Arc<Self> {
        Arc::new(Self {
            policy,
            state: Mutex::new(State::default()),
            changed: Condvar::new(),
        })
    }
    fn acquire(self: &Arc<Self>, _kind: Kind, cancelled: impl Fn() -> bool) -> io::Result<Permit> {
        if cancelled() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "任务已取消"));
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| io::Error::other("后台任务队列不可用"))?;
        if cancelled() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "任务已取消"));
        }
        if (state.active >= self.policy.active_heavy || !state.waiting.is_empty())
            && state.waiting.len() >= self.policy.queued_heavy
        {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "后台任务等待队列已满，请稍后重试",
            ));
        }
        let ticket = state.next_ticket;
        state.next_ticket = ticket
            .checked_add(1)
            .ok_or_else(|| io::Error::other("后台任务队列序号已耗尽，请重启应用"))?;
        state.waiting.push_back(ticket);
        loop {
            if cancelled() {
                state.waiting.retain(|value| *value != ticket);
                self.changed.notify_all();
                return Err(io::Error::new(io::ErrorKind::Interrupted, "任务已取消"));
            }
            if state.active < self.policy.active_heavy && state.waiting.front() == Some(&ticket) {
                state.waiting.pop_front();
                state.active += 1;
                self.changed.notify_all();
                return Ok(Permit {
                    budget: self.clone(),
                });
            }
            state = self
                .changed
                .wait_timeout(
                    state,
                    Duration::from_millis(self.policy.cancellation_poll_ms),
                )
                .map_err(|_| io::Error::other("后台任务队列不可用"))?
                .0;
        }
    }
}
impl Drop for Permit {
    fn drop(&mut self) {
        let mut state = self
            .budget
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        state.active -= 1;
        self.budget.changed.notify_all();
    }
}
pub(crate) fn acquire(kind: Kind, cancelled: impl Fn() -> bool) -> io::Result<Permit> {
    static BUDGET: OnceLock<Result<Arc<Budget>, String>> = OnceLock::new();
    let budget = BUDGET.get_or_init(|| {
        Policy::parse(include_str!("task-admission-policy.json"))
            .map(Budget::new)
            .map_err(|error| error.to_string())
    });
    budget
        .as_ref()
        .map_err(|error| io::Error::other(error.clone()))?
        .acquire(kind, cancelled)
}
#[cfg(test)]
#[path = "task_admission_tests.rs"]
mod tests;
