//! File grants originate only from native pickers, file-open events, or recents.
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const MAX_DOCUMENT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocumentKind {
    Project,
    Message,
}

impl DocumentKind {
    pub fn parse(kind: &str) -> Result<Self, String> {
        match kind {
            "project" => Ok(Self::Project),
            "message" => Ok(Self::Message),
            _ => Err("Unsupported document type.".into()),
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Project => "badge",
            Self::Message => "badgemsg",
        }
    }
}

fn document_path(path: &Path, kind: DocumentKind) -> Result<PathBuf, String> {
    let resolved = if path.exists() {
        path.canonicalize()
    } else {
        path.parent()
            .ok_or("Missing parent directory.")?
            .canonicalize()
            .map(|parent| parent.join(path.file_name().unwrap_or_default()))
    }
    .map_err(|e| format!("Could not resolve document: {e}"))?;
    if resolved.is_dir()
        || !resolved
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case(kind.extension()))
    {
        return Err(format!("Select a .{} file.", kind.extension()));
    }
    Ok(resolved)
}

#[derive(Default)]
pub struct FileAccess(Mutex<HashMap<PathBuf, DocumentKind>>);

impl FileAccess {
    pub fn grant(&self, path: &Path, kind: DocumentKind) -> Result<PathBuf, String> {
        let path = document_path(path, kind)?;
        self.0
            .lock()
            .map_err(|_| "File permissions unavailable.")?
            .insert(path.clone(), kind);
        Ok(path)
    }

    pub fn authorized(&self, path: &Path, kind: DocumentKind) -> Result<PathBuf, String> {
        let path = document_path(path, kind)?;
        if self
            .0
            .lock()
            .map_err(|_| "File permissions unavailable.")?
            .get(&path)
            != Some(&kind)
        {
            return Err("Choose this file with Open or Save As first.".into());
        }
        Ok(path)
    }
}

pub fn read_bounded(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Could not open file: {e}"))?;
    if file.metadata().map_err(|e| e.to_string())?.len() > limit as u64 {
        return Err(format!(
            "File exceeds the {} MiB limit.",
            limit / (1024 * 1024)
        ));
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        return Err("File exceeds the size limit.".into());
    }
    Ok(bytes)
}

/// Write in the same directory, then atomically replace the destination.
/// A failed write leaves the original document intact.
pub fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing document directory.")?;
    let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    if let Ok(meta) = std::fs::metadata(path) {
        staged
            .as_file()
            .set_permissions(meta.permissions())
            .map_err(|e| e.to_string())?;
    }
    staged
        .write_all(contents)
        .map_err(|e| format!("Could not write file: {e}"))?;
    staged.as_file().sync_all().map_err(|e| e.to_string())?;
    staged
        .persist(path)
        .map_err(|e| format!("Could not replace file: {e}"))?;
    #[cfg(unix)]
    std::fs::File::open(parent)
        .and_then(|dir| dir.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_selected_documents_can_be_accessed() {
        let dir = tempfile::tempdir().unwrap();
        let chosen = dir.path().join("chosen.badge");
        let other = dir.path().join("other.badge");
        let access = FileAccess::default();
        assert!(access.authorized(&chosen, DocumentKind::Project).is_err());
        access.grant(&chosen, DocumentKind::Project).unwrap();
        assert!(access.authorized(&chosen, DocumentKind::Project).is_ok());
        assert!(access.authorized(&other, DocumentKind::Project).is_err());
        assert!(access.authorized(&chosen, DocumentKind::Message).is_err());
        assert!(access
            .grant(&dir.path().join("config"), DocumentKind::Project)
            .is_err());
    }

    #[test]
    fn bounded_reads_and_atomic_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.badge");
        atomic_write(&path, b"original").unwrap();
        assert!(read_bounded(&path, 7).is_err());
        assert_eq!(read_bounded(&path, 8).unwrap(), b"original");
        atomic_write(&path, b"replacement").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"replacement");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn replacing_a_granted_path_with_a_symlink_does_not_expand_access() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("chosen.badge");
        let target = dir.path().join("other.badge");
        std::fs::write(&path, "original").unwrap();
        std::fs::write(&target, "private").unwrap();
        let access = FileAccess::default();
        access.grant(&path, DocumentKind::Project).unwrap();
        std::fs::remove_file(&path).unwrap();
        std::os::unix::fs::symlink(&target, &path).unwrap();
        assert!(access.authorized(&path, DocumentKind::Project).is_err());
    }
}
