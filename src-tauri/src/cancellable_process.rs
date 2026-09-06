use std::{
    io::{self, Read},
    process::{Command, Output, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Clone, Debug, Default)]
pub(crate) struct Cancellation(Arc<AtomicBool>);
impl Cancellation {
    pub(crate) fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }
    pub(crate) fn check(&self) -> io::Result<()> {
        if self.0.load(Ordering::Acquire) {
            Err(io::Error::new(io::ErrorKind::Interrupted, "准备已取消"))
        } else {
            Ok(())
        }
    }
}

pub(crate) fn output(command: &mut Command, cancel: &Cancellation) -> io::Result<Output> {
    cancel.check()?;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut process_group = match crate::process_group::ProcessGroup::assign(&child) {
        Ok(group) => group,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    // Drain both pipes concurrently, including after their retained tail reaches the bound.
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    std::thread::scope(|scope| {
        let out = scope.spawn(move || drain(stdout));
        let err = scope.spawn(move || drain(stderr));
        let status = loop {
            if let Err(error) = cancel.check() {
                process_group.terminate();
                let _ = child.kill();
                let _ = child.wait();
                break Err(error);
            }
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
                Err(error) => {
                    process_group.terminate();
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err(error);
                }
            }
        };
        // Closing the owned job also releases pipes held by descendants.
        drop(process_group);
        let stdout = out.join().map_err(|_| io::Error::other("输出读取中断"))?;
        let stderr = err
            .join()
            .map_err(|_| io::Error::other("错误输出读取中断"))?;
        Ok(Output {
            status: status?,
            stdout: stdout?,
            stderr: stderr?,
        })
    })
}

fn drain(mut reader: impl Read) -> io::Result<Vec<u8>> {
    const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
    let mut output = Vec::new();
    let mut buffer = [0; 8192];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            return Ok(output);
        }
        if output.len() + count > MAX_OUTPUT_BYTES {
            output.drain(..output.len() + count - MAX_OUTPUT_BYTES);
        }
        output.extend_from_slice(&buffer[..count]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        thread,
        time::{Duration, Instant},
    };

    fn slow_command() -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        let test = format!("{}::slow_child", module_path!().split_once("::").unwrap().1);
        command.args(["--exact", &test, "--ignored"]);
        command
    }

    #[test]
    fn cancellation_stops_a_running_owned_process_before_returning() {
        let cancel = Cancellation::default();
        let request = cancel.clone();
        let marker = std::env::temp_dir().join(format!(
            "siaovplay-cancel-{}-{}.txt",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let child_marker = marker.clone();
        let started = Instant::now();
        let worker = thread::spawn(move || {
            output(
                slow_command().env("SIAOVPLAY_CANCEL_TEST_MARKER", child_marker),
                &cancel,
            )
        });
        while !marker.exists() && started.elapsed() < Duration::from_secs(2) {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(
            marker.exists(),
            "child must be observed running before cancellation"
        );
        request.cancel();
        assert_eq!(
            worker.join().unwrap().unwrap_err().kind(),
            io::ErrorKind::Interrupted
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        let after = std::fs::read(&marker).unwrap();
        thread::sleep(Duration::from_millis(150));
        assert_eq!(
            after,
            std::fs::read(&marker).unwrap(),
            "no writes may remain after cancellation returns"
        );
        std::fs::remove_file(marker).unwrap();
    }

    #[test]
    fn cancellation_before_spawn_does_not_execute_the_command() {
        let cancel = Cancellation::default();
        cancel.cancel();
        let started = Instant::now();
        assert_eq!(
            output(&mut slow_command(), &cancel).unwrap_err().kind(),
            io::ErrorKind::Interrupted
        );
        assert!(started.elapsed() < Duration::from_millis(500));
    }

    #[test]
    #[ignore = "subprocess fixture"]
    fn slow_child() {
        for index in 0..150 {
            if let Some(marker) = std::env::var_os("SIAOVPLAY_CANCEL_TEST_MARKER") {
                std::fs::write(marker, index.to_string()).unwrap();
            }
            thread::sleep(Duration::from_millis(20));
        }
    }
}
