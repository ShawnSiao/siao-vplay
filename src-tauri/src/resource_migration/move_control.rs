use super::ResourceMigrationError;
use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Default)]
struct State {
    cancelled: bool,
    committing: bool,
}
type Control = Arc<Mutex<State>>;
#[derive(Default)]
struct Registry {
    active: HashMap<String, Control>,
    pending: HashMap<String, Instant>,
    finished: VecDeque<String>,
}
static MOVES: OnceLock<Mutex<Registry>> = OnceLock::new();
thread_local! { static CURRENT: RefCell<Option<Control>> = const { RefCell::new(None) }; }

fn registry() -> &'static Mutex<Registry> {
    MOVES.get_or_init(Mutex::default)
}
fn invalid() -> ResourceMigrationError {
    ResourceMigrationError::Busy
}
pub(crate) struct RegisteredMove {
    id: String,
    control: Control,
}

pub(crate) fn register(id: &str) -> Result<RegisteredMove, ResourceMigrationError> {
    uuid::Uuid::parse_str(id).map_err(|_| invalid())?;
    let mut registry = registry().lock().map_err(|_| invalid())?;
    if registry.active.len() >= 32
        || registry.active.contains_key(id)
        || registry.finished.iter().any(|finished| finished == id)
    {
        return Err(invalid());
    }
    let control = Arc::new(Mutex::new(State {
        cancelled: registry.pending.remove(id).is_some(),
        committing: false,
    }));
    registry.active.insert(id.to_owned(), control.clone());
    Ok(RegisteredMove {
        id: id.to_owned(),
        control,
    })
}

pub(crate) fn cancel(id: &str) -> Result<bool, ResourceMigrationError> {
    uuid::Uuid::parse_str(id).map_err(|_| invalid())?;
    let mut registry = registry().lock().map_err(|_| invalid())?;
    if registry.finished.iter().any(|finished| finished == id) {
        return Ok(false);
    }
    let Some(control) = registry.active.get(id) else {
        registry
            .pending
            .retain(|_, at| at.elapsed() < Duration::from_secs(60));
        if registry.pending.len() >= 32 && !registry.pending.contains_key(id) {
            return Err(invalid());
        }
        registry.pending.insert(id.to_owned(), Instant::now());
        return Ok(true);
    };
    let mut state = control.lock().map_err(|_| invalid())?;
    if state.committing {
        return Ok(false);
    }
    state.cancelled = true;
    Ok(true)
}

impl RegisteredMove {
    pub(crate) fn run<T>(
        self,
        operation: impl FnOnce() -> Result<T, ResourceMigrationError>,
    ) -> Result<T, ResourceMigrationError> {
        struct Scope(Option<Control>);
        impl Drop for Scope {
            fn drop(&mut self) {
                CURRENT.with(|value| {
                    value.replace(self.0.take());
                });
            }
        }
        let _scope = Scope(CURRENT.with(|value| value.replace(Some(self.control.clone()))));
        check()?;
        operation()
    }
}
impl Drop for RegisteredMove {
    fn drop(&mut self) {
        if let Ok(mut registry) = registry().lock() {
            registry.active.remove(&self.id);
            registry.finished.push_back(self.id.clone());
            if registry.finished.len() > 128 {
                registry.finished.pop_front();
            }
        }
    }
}

pub(super) fn check() -> Result<(), ResourceMigrationError> {
    CURRENT.with(|control| {
        if let Some(control) = control.borrow().as_ref() {
            if control.lock().map_err(|_| invalid())?.cancelled {
                return Err(ResourceMigrationError::Cancelled);
            }
        }
        Ok(())
    })
}

pub(super) fn begin_commit() -> Result<(), ResourceMigrationError> {
    CURRENT.with(|control| {
        if let Some(control) = control.borrow().as_ref() {
            let mut state = control.lock().map_err(|_| invalid())?;
            if state.cancelled {
                return Err(ResourceMigrationError::Cancelled);
            }
            state.committing = true;
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_before_registration_prevents_work_and_commit_is_explicit() {
        let id = uuid::Uuid::new_v4().to_string();
        cancel(&id).unwrap();
        assert!(matches!(
            register(&id)
                .unwrap()
                .run::<()>(|| panic!("cancelled work ran")),
            Err(ResourceMigrationError::Cancelled)
        ));
        assert!(
            !cancel(&id).unwrap(),
            "terminal tasks reject late cancellation"
        );
        assert!(
            register(&id).is_err(),
            "completed request IDs cannot be reused"
        );
        let id = uuid::Uuid::new_v4().to_string();
        register(&id)
            .unwrap()
            .run(|| {
                begin_commit()?;
                assert!(!cancel(&id)?);
                check()
            })
            .unwrap();
    }
}
