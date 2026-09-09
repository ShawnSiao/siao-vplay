use super::*;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::Instant,
};
fn budget() -> Arc<Budget> {
    Budget::new(Policy {
        active_heavy: 1,
        queued_heavy: 2,
        cancellation_poll_ms: 5,
    })
}
#[test]
fn heavy_work_of_different_kinds_waits_for_shared_capacity() {
    let budget = budget();
    let first = budget.acquire(Kind::Transcription, || false).unwrap();
    let other = budget.clone();
    let (send, receive) = mpsc::channel();
    let worker = thread::spawn(move || {
        let _permit = other.acquire(Kind::SubtitleBurn, || false).unwrap();
        send.send(()).unwrap();
    });
    assert!(
        receive.recv_timeout(Duration::from_millis(50)).is_err(),
        "burn must wait while transcription owns the slot"
    );
    drop(first);
    receive.recv_timeout(Duration::from_secs(2)).unwrap();
    worker.join().unwrap();
}
fn wait_pending(budget: &Budget, count: usize) {
    let deadline = Instant::now() + Duration::from_secs(3);
    while budget.state.lock().unwrap().waiting.len() != count {
        assert!(Instant::now() < deadline, "waiter did not reach queue");
        thread::sleep(Duration::from_millis(1));
    }
}
#[test]
fn cancelling_a_waiter_does_not_release_another_tasks_slot() {
    let budget = budget();
    let first = budget.acquire(Kind::Transcription, || false).unwrap();
    let cancelled = Arc::new(AtomicBool::new(false));
    let (other, flag) = (budget.clone(), cancelled.clone());
    let worker = thread::spawn(move || {
        other
            .acquire(Kind::PlaybackProxy, || flag.load(Ordering::SeqCst))
            .err()
            .unwrap()
            .kind()
    });
    wait_pending(&budget, 1);
    cancelled.store(true, Ordering::SeqCst);
    assert_eq!(worker.join().unwrap(), io::ErrorKind::Interrupted);
    let state = budget.state.lock().unwrap();
    assert_eq!(state.active, 1);
    assert!(state.waiting.is_empty());
    drop(state);
    drop(first);
    assert_eq!(budget.state.lock().unwrap().active, 0);
}
#[test]
fn queued_kinds_are_fifo_and_overflow_is_rejected() {
    let budget = budget();
    let first = budget.acquire(Kind::Transcription, || false).unwrap();
    let (send, receive) = mpsc::channel();
    let mut workers = Vec::new();
    for (index, kind) in [Kind::SubtitleBurn, Kind::PlaybackProxy]
        .into_iter()
        .enumerate()
    {
        let (other, send) = (budget.clone(), send.clone());
        workers.push(thread::spawn(move || {
            let _permit = other.acquire(kind, || false).unwrap();
            send.send(index).unwrap();
        }));
        wait_pending(&budget, index + 1);
    }
    assert_eq!(
        budget
            .acquire(Kind::Transcription, || false)
            .err()
            .unwrap()
            .kind(),
        io::ErrorKind::WouldBlock
    );
    drop(first);
    assert_eq!(receive.recv_timeout(Duration::from_secs(3)).unwrap(), 0);
    assert_eq!(receive.recv_timeout(Duration::from_secs(3)).unwrap(), 1);
    for worker in workers {
        worker.join().unwrap();
    }
}
#[test]
fn configured_capacity_and_unwind_release_are_preserved() {
    let budget = Budget::new(Policy {
        active_heavy: 2,
        queued_heavy: 0,
        cancellation_poll_ms: 5,
    });
    let first = budget.acquire(Kind::Transcription, || false).unwrap();
    let second = budget.acquire(Kind::SubtitleBurn, || false).unwrap();
    assert_eq!(
        budget
            .acquire(Kind::PlaybackProxy, || false)
            .err()
            .unwrap()
            .kind(),
        io::ErrorKind::WouldBlock
    );
    drop(second);
    drop(first);
    let _ = std::panic::catch_unwind(|| {
        let _permit = budget.acquire(Kind::Transcription, || false).unwrap();
        panic!("synthetic worker failure");
    });
    assert_eq!(budget.state.lock().unwrap().active, 0);
    assert_eq!(
        budget
            .acquire(Kind::PlaybackProxy, || true)
            .err()
            .unwrap()
            .kind(),
        io::ErrorKind::Interrupted
    );
    assert!(budget.acquire(Kind::PlaybackProxy, || false).is_ok());
}
#[test]
fn policy_rejects_unknown_and_unbounded_values() {
    assert!(Policy::parse(include_str!("task-admission-policy.json")).is_ok());
    for json in [
        r#"{"activeHeavy":0,"queuedHeavy":16,"cancellationPollMs":50}"#,
        r#"{"activeHeavy":1,"queuedHeavy":129,"cancellationPollMs":50}"#,
        r#"{"activeHeavy":1,"queuedHeavy":16,"cancellationPollMs":999}"#,
        r#"{"activeHeavy":1,"queuedHeavy":16,"cancellationPollMs":50,"typo":1}"#,
    ] {
        assert!(Policy::parse(json).is_err());
    }
}
#[test]
fn a_released_slot_does_not_allow_new_arrivals_to_overfill_waiters() {
    let budget = budget();
    // A holder released its slot, but the notified head waiter has not resumed yet.
    {
        let mut state = budget.state.lock().unwrap();
        state.waiting.extend([0, 1]);
        state.next_ticket = 2;
    }
    let flag = Arc::new(AtomicBool::new(false));
    let (other, cancelled) = (budget.clone(), flag.clone());
    let (send, receive) = mpsc::channel();
    let worker = thread::spawn(move || {
        send.send(
            other
                .acquire(Kind::PlaybackProxy, || cancelled.load(Ordering::SeqCst))
                .err()
                .unwrap()
                .kind(),
        )
        .unwrap();
    });
    let outcome = receive.recv_timeout(Duration::from_millis(100));
    flag.store(true, Ordering::SeqCst);
    worker.join().unwrap();
    assert_eq!(outcome.unwrap(), io::ErrorKind::WouldBlock);
    assert_eq!(budget.state.lock().unwrap().waiting.len(), 2);
}
#[test]
fn cancellation_while_waiting_for_the_queue_lock_wins_over_queue_full() {
    let budget = Budget::new(Policy {
        active_heavy: 1,
        queued_heavy: 0,
        cancellation_poll_ms: 5,
    });
    let permit = budget.acquire(Kind::Transcription, || false).unwrap();
    let locked = budget.state.lock().unwrap();
    let flag = Arc::new(AtomicBool::new(false));
    let (other, cancelled) = (budget.clone(), flag.clone());
    let (send, receive) = mpsc::channel();
    let worker = thread::spawn(move || {
        let checked = AtomicBool::new(false);
        other
            .acquire(Kind::SubtitleBurn, || {
                let value = cancelled.load(Ordering::SeqCst);
                if !checked.swap(true, Ordering::SeqCst) {
                    send.send(()).unwrap();
                }
                value
            })
            .err()
            .unwrap()
            .kind()
    });
    receive.recv_timeout(Duration::from_secs(3)).unwrap();
    flag.store(true, Ordering::SeqCst);
    drop(locked);
    assert_eq!(worker.join().unwrap(), io::ErrorKind::Interrupted);
    drop(permit);
}
