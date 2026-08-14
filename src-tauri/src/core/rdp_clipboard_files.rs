//! Helpers for RDP CLIPRDR file transfer (local path validation + descriptors).

use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

use ironrdp::cliprdr::pdu::{ClipboardFileAttributes, FileDescriptor};

pub const MAX_OFFERED_FILES: usize = 64;
pub const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_CHUNK_BYTES: u32 = 64 * 1024;

const WINDOWS_RESERVED_DEVICE_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

#[derive(Debug, Clone)]
pub struct OfferedLocalFile {
    pub path: PathBuf,
    pub descriptor: FileDescriptor,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OfferFilesError {
    Empty,
    TooMany(usize),
    TooLarge { path: String, size: u64 },
    Io { path: String, message: String },
}

impl std::fmt::Display for OfferFilesError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty => write!(f, "no files to offer"),
            Self::TooMany(limit) => write!(f, "too many files (max {limit})"),
            Self::TooLarge { path, size } => {
                write!(f, "file too large ({size} bytes): {path}")
            }
            Self::Io { path, message } => write!(f, "cannot read {path}: {message}"),
        }
    }
}

fn file_name_only(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
}

/// Walk `root` and append `(absolute_path, relative_dir, basename)` entries.
fn walk_files(
    root: &Path,
    relative_dir: Option<&str>,
    out: &mut Vec<(PathBuf, Option<String>, String)>,
) -> Result<(), OfferFilesError> {
    let meta = fs::metadata(root).map_err(|err| OfferFilesError::Io {
        path: root.display().to_string(),
        message: err.to_string(),
    })?;

    if meta.is_file() {
        let name = file_name_only(root).ok_or_else(|| OfferFilesError::Io {
            path: root.display().to_string(),
            message: "missing file name".to_string(),
        })?;
        out.push((
            root.to_path_buf(),
            relative_dir.map(str::to_string),
            name,
        ));
        return Ok(());
    }

    if !meta.is_dir() {
        return Ok(());
    }

    let dir_name = file_name_only(root).unwrap_or_else(|| "folder".to_string());
    let this_rel = match relative_dir {
        Some(prefix) if !prefix.is_empty() => format!("{prefix}\\{dir_name}"),
        _ => dir_name,
    };

    for entry in fs::read_dir(root).map_err(|err| OfferFilesError::Io {
        path: root.display().to_string(),
        message: err.to_string(),
    })? {
        let entry = entry.map_err(|err| OfferFilesError::Io {
            path: root.display().to_string(),
            message: err.to_string(),
        })?;
        let child = entry.path();
        let child_meta = entry.metadata().map_err(|err| OfferFilesError::Io {
            path: child.display().to_string(),
            message: err.to_string(),
        })?;
        if child_meta.is_dir() {
            walk_files(&child, Some(&this_rel), out)?;
        } else if child_meta.is_file() {
            let name = file_name_only(&child).ok_or_else(|| OfferFilesError::Io {
                path: child.display().to_string(),
                message: "missing file name".to_string(),
            })?;
            out.push((child, Some(this_rel.clone()), name));
        }
        if out.len() > MAX_OFFERED_FILES {
            return Err(OfferFilesError::TooMany(MAX_OFFERED_FILES));
        }
    }
    Ok(())
}

/// Build offered local file list for CLIPRDR `initiate_file_copy`.
pub fn build_offered_local_files(paths: &[String]) -> Result<Vec<OfferedLocalFile>, OfferFilesError> {
    let mut collected = Vec::new();
    for raw in paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let path = PathBuf::from(trimmed);
        if !path.exists() {
            return Err(OfferFilesError::Io {
                path: trimmed.to_string(),
                message: "path does not exist".to_string(),
            });
        }
        walk_files(&path, None, &mut collected)?;
        if collected.len() > MAX_OFFERED_FILES {
            return Err(OfferFilesError::TooMany(MAX_OFFERED_FILES));
        }
    }
    if collected.is_empty() {
        return Err(OfferFilesError::Empty);
    }

    let mut offered = Vec::with_capacity(collected.len());
    for (path, relative_path, name) in collected {
        let meta = fs::metadata(&path).map_err(|err| OfferFilesError::Io {
            path: path.display().to_string(),
            message: err.to_string(),
        })?;
        let size = meta.len();
        if size > MAX_FILE_BYTES {
            return Err(OfferFilesError::TooLarge {
                path: path.display().to_string(),
                size,
            });
        }
        let mut descriptor = FileDescriptor::new(name)
            .with_attributes(ClipboardFileAttributes::NORMAL)
            .with_file_size(size);
        if let Some(rel) = relative_path.filter(|value| !value.is_empty()) {
            descriptor = descriptor.with_relative_path(rel);
        }
        offered.push(OfferedLocalFile { path, descriptor });
    }
    Ok(offered)
}

pub fn read_offered_file_chunk(
    path: &Path,
    position: u64,
    requested_size: u32,
) -> Result<Vec<u8>, String> {
    let mut file = fs::File::open(path).map_err(|err| format!("open {}: {err}", path.display()))?;
    file.seek(SeekFrom::Start(position))
        .map_err(|err| format!("seek {}: {err}", path.display()))?;
    let to_read = requested_size.min(MAX_CHUNK_BYTES) as usize;
    let mut buffer = vec![0u8; to_read];
    let read = file
        .read(&mut buffer)
        .map_err(|err| format!("read {}: {err}", path.display()))?;
    buffer.truncate(read);
    Ok(buffer)
}

pub fn sanitize_remote_file_name(name: &str) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }
    let base = Path::new(trimmed)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(trimmed);
    let cleaned = base
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect::<String>();
    let cleaned = cleaned.trim_matches('.').trim();
    if cleaned.is_empty() {
        return None;
    }
    let upper = cleaned.to_ascii_uppercase();
    if WINDOWS_RESERVED_DEVICE_NAMES
        .iter()
        .any(|device| *device == upper)
    {
        return None;
    }
    Some(cleaned.to_string())
}

/// Bytes to request in a CLIPRDR RANGE read at `position`, capped by remaining file size.
pub fn cliprdr_range_request_size(position: u64, file_size: Option<u64>) -> u32 {
    let Some(file_size) = file_size else {
        return MAX_CHUNK_BYTES;
    };
    if position >= file_size {
        return 0;
    }
    let remaining = file_size - position;
    (remaining.min(u64::from(MAX_CHUNK_BYTES))) as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn builds_descriptor_for_single_file() {
        let dir = std::env::temp_dir().join(format!("nyaterm-rdp-clip-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("hello.txt");
        fs::write(&file, b"abc").unwrap();
        let offered = build_offered_local_files(&[file.to_string_lossy().to_string()]).unwrap();
        assert_eq!(offered.len(), 1);
        assert_eq!(offered[0].descriptor.name, "hello.txt");
        assert_eq!(offered[0].descriptor.file_size, Some(3));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_empty_offer() {
        let err = build_offered_local_files(&[]).unwrap_err();
        assert_eq!(err, OfferFilesError::Empty);
    }

    #[test]
    fn rejects_too_many_files() {
        let dir = std::env::temp_dir().join(format!("nyaterm-rdp-many-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let mut paths = Vec::new();
        for index in 0..(MAX_OFFERED_FILES + 1) {
            let file = dir.join(format!("f{index}.txt"));
            fs::write(&file, b"x").unwrap();
            paths.push(file.to_string_lossy().to_string());
        }
        let err = build_offered_local_files(&paths).unwrap_err();
        assert_eq!(err, OfferFilesError::TooMany(MAX_OFFERED_FILES));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn sanitizes_remote_names() {
        assert_eq!(
            sanitize_remote_file_name("..\\evil.txt").as_deref(),
            Some("evil.txt")
        );
        assert!(sanitize_remote_file_name("CON").is_none());
    }

    #[test]
    fn caps_range_request_to_remaining_bytes() {
        assert_eq!(cliprdr_range_request_size(0, Some(100)), 100);
        assert_eq!(
            cliprdr_range_request_size(0, Some(u64::from(MAX_CHUNK_BYTES) + 1)),
            MAX_CHUNK_BYTES
        );
        assert_eq!(cliprdr_range_request_size(100, Some(150)), 50);
        assert_eq!(cliprdr_range_request_size(150, Some(150)), 0);
        assert_eq!(cliprdr_range_request_size(0, None), MAX_CHUNK_BYTES);
    }

    #[test]
    fn reads_file_chunk() {
        let dir = std::env::temp_dir().join(format!("nyaterm-rdp-chunk-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("data.bin");
        let mut handle = fs::File::create(&file).unwrap();
        handle.write_all(b"0123456789").unwrap();
        let chunk = read_offered_file_chunk(&file, 2, 4).unwrap();
        assert_eq!(chunk, b"2345");
        let _ = fs::remove_dir_all(dir);
    }
}
