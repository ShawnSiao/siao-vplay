use super::StorageError;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::sync::atomic::AtomicBool;

pub(super) fn check(cancelled: &AtomicBool) -> Result<(), StorageError> {
    if cancelled.load(std::sync::atomic::Ordering::Relaxed) {
        Err(StorageError::MigrationCancelled)
    } else {
        Ok(())
    }
}

fn read_chunk(
    reader: &mut impl Read,
    buffer: &mut [u8],
    cancelled: &AtomicBool,
) -> Result<usize, StorageError> {
    loop {
        check(cancelled)?;
        match reader.read(buffer) {
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            result => {
                let count = result?;
                check(cancelled)?;
                return Ok(count);
            }
        }
    }
}

pub(super) fn copy_bytes(
    reader: &mut impl Read,
    writer: &mut impl Write,
    cancelled: &AtomicBool,
) -> Result<(), StorageError> {
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = read_chunk(reader, &mut buffer, cancelled)?;
        if count == 0 {
            return Ok(());
        }
        writer.write_all(&buffer[..count])?;
    }
}

pub(super) fn hash_bytes(
    reader: &mut impl Read,
    cancelled: &AtomicBool,
) -> Result<String, StorageError> {
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = read_chunk(reader, &mut buffer, cancelled)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;
    #[test]
    fn successful_streams_preserve_bytes_and_sha256() {
        let cancelled = AtomicBool::new(false);
        let bytes = vec![17_u8; 150_000];
        let mut output = Vec::new();
        copy_bytes(&mut bytes.as_slice(), &mut output, &cancelled).unwrap();
        assert_eq!(output, bytes);
        assert_eq!(
            hash_bytes(&mut b"abc".as_slice(), &cancelled).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
    #[test]
    fn interrupted_reads_are_retried_without_losing_bytes() {
        struct Reader(bool);
        impl Read for Reader {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                if !self.0 {
                    self.0 = true;
                    return Err(std::io::ErrorKind::Interrupted.into());
                }
                Ok(0)
            }
        }
        let mut output = Vec::new();
        copy_bytes(&mut Reader(false), &mut output, &AtomicBool::new(false)).unwrap();
        assert!(output.is_empty());
    }
    struct CancellingReader<'a>(&'a AtomicBool, usize);
    impl Read for CancellingReader<'_> {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            self.1 += 1;
            assert_eq!(self.1, 1, "cancelled operation read another chunk");
            buffer.fill(7);
            self.0.store(true, Ordering::Relaxed);
            Ok(buffer.len())
        }
    }
    #[test]
    fn copy_stops_after_cancellation_during_read_without_writing() {
        let cancelled = AtomicBool::new(false);
        let mut reader = CancellingReader(&cancelled, 0);
        let mut output = Vec::new();
        assert!(matches!(
            copy_bytes(&mut reader, &mut output, &cancelled),
            Err(StorageError::MigrationCancelled)
        ));
        assert!(output.is_empty());
    }
    #[test]
    fn hashing_stops_after_cancellation_during_read() {
        let cancelled = AtomicBool::new(false);
        assert!(matches!(
            hash_bytes(&mut CancellingReader(&cancelled, 0), &cancelled),
            Err(StorageError::MigrationCancelled)
        ));
    }
}
