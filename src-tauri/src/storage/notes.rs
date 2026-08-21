use crate::config::{
    DeleteNoteNodeResult, NoteDocument, NoteFolder, NoteNodeChange, NoteSummary, NoteUpdateResult,
    NotesSnapshot,
};
use crate::error::{AppError, AppResult};
use redb::{ReadableDatabase, ReadableTable};
use std::collections::{HashMap, HashSet};

use super::Storage;
use super::tables::*;
use super::util::*;

const DEFAULT_NOTE_TITLE: &str = "新建笔记";
const DEFAULT_FOLDER_NAME: &str = "新建文件夹";
const MAX_NOTE_NAME_CHARS: usize = 120;
const NOTE_SUMMARY_INDEX_VERSION: u32 = 1;

trait NoteListItem {
    fn id(&self) -> &str;
    fn parent_id(&self) -> Option<&str>;
    fn title(&self) -> &str;
    fn sort_order(&self) -> i64;
}

impl NoteListItem for NoteDocument {
    fn id(&self) -> &str {
        &self.id
    }

    fn parent_id(&self) -> Option<&str> {
        self.parent_id.as_deref()
    }

    fn title(&self) -> &str {
        &self.title
    }

    fn sort_order(&self) -> i64 {
        self.sort_order
    }
}

impl NoteListItem for NoteSummary {
    fn id(&self) -> &str {
        &self.id
    }

    fn parent_id(&self) -> Option<&str> {
        self.parent_id.as_deref()
    }

    fn title(&self) -> &str {
        &self.title
    }

    fn sort_order(&self) -> i64 {
        self.sort_order
    }
}

impl Storage {
    pub fn list_note_folders(&self) -> AppResult<Vec<NoteFolder>> {
        let mut folders = self.list_json_by_prefix(NOTE_FOLDERS_TABLE, NOTE_FOLDER_PREFIX)?;
        sort_note_folders(&mut folders);
        Ok(folders)
    }

    pub fn list_notes(&self) -> AppResult<Vec<NoteDocument>> {
        let mut notes = self.list_json_by_prefix(NOTES_TABLE, NOTE_DOCUMENT_PREFIX)?;
        sort_notes(&mut notes);
        Ok(notes)
    }

    pub fn list_note_summaries(&self) -> AppResult<Vec<NoteSummary>> {
        self.ensure_note_summary_index()?;
        let mut notes = self.list_json_by_prefix(NOTE_SUMMARIES_TABLE, NOTE_SUMMARY_PREFIX)?;
        sort_note_summaries(&mut notes);
        Ok(notes)
    }

    pub fn get_note(&self, note_id: &str) -> AppResult<Option<NoteDocument>> {
        self.read_json(NOTES_TABLE, &entity_key(NOTE_DOCUMENT_PREFIX, note_id))
    }

    pub fn create_note_folder(
        &self,
        parent_id: Option<String>,
        name: Option<String>,
    ) -> AppResult<NoteFolder> {
        self.ensure_note_summary_index()?;
        let txn = self.db.begin_write().map_err(storage_error)?;
        let mut folders = read_note_folders_in_txn(&txn)?;
        let notes = read_note_summaries_in_txn(&txn)?;
        validate_parent_exists(&folders, parent_id.as_deref())?;
        let sibling_names = sibling_names(&folders, &notes, parent_id.as_deref(), None);
        let name = normalize_or_unique_name(name, DEFAULT_FOLDER_NAME, &sibling_names)?;
        let sort_order = next_sort_order_for_parent(&folders, &notes, parent_id.as_deref());
        let now = current_time_ms();
        let (encrypted, encryption) = inherit_folder_encryption(&folders, parent_id.as_deref());
        let folder = NoteFolder {
            id: uuid::Uuid::new_v4().to_string(),
            parent_id,
            name,
            sort_order,
            created_at_ms: now,
            updated_at_ms: now,
            encrypted,
            encryption,
        };
        write_note_folder_in_txn(&txn, &folder)?;
        txn.commit().map_err(storage_error)?;
        folders.push(folder.clone());
        Ok(folder)
    }

    pub fn create_note(
        &self,
        parent_id: Option<String>,
        title: Option<String>,
        markdown: Option<String>,
        password: Option<String>,
    ) -> AppResult<NoteDocument> {
        self.ensure_note_summary_index()?;
        let txn = self.db.begin_write().map_err(storage_error)?;
        let folders = read_note_folders_in_txn(&txn)?;
        let mut notes = read_note_summaries_in_txn(&txn)?;
        validate_parent_exists(&folders, parent_id.as_deref())?;
        let sibling_names = sibling_names(&folders, &notes, parent_id.as_deref(), None);
        let title = normalize_or_unique_name(title, DEFAULT_NOTE_TITLE, &sibling_names)?;
        let sort_order = next_sort_order_for_parent(&folders, &notes, parent_id.as_deref());
        let now = current_time_ms();
        let root_folder_id = encryption_root_id_for_parent(&folders, parent_id.as_deref());
        let plaintext = markdown.unwrap_or_default();
        let (encrypted, encryption, stored_markdown) = if let Some(root_id) = root_folder_id {
            let password = password.ok_or_else(|| {
                AppError::Config(
                    "Password required to create a note inside an encrypted folder".to_string(),
                )
            })?;
            let meta = crate::core::note_crypto::encrypt_markdown(
                &plaintext,
                &password,
                Some(root_id),
            )?;
            (true, Some(meta), String::new())
        } else {
            (false, None, plaintext)
        };
        let note = NoteDocument {
            id: uuid::Uuid::new_v4().to_string(),
            parent_id,
            title,
            markdown: stored_markdown,
            sort_order,
            revision: 1,
            created_at_ms: now,
            updated_at_ms: now,
            encrypted,
            encryption,
        };
        write_note_in_txn(&txn, &note)?;
        write_note_summary_in_txn(&txn, &NoteSummary::from(note.clone()))?;
        txn.commit().map_err(storage_error)?;
        notes.push(NoteSummary::from(note.clone()));
        Ok(note)
    }

    pub fn update_note(
        &self,
        note_id: &str,
        title: String,
        markdown: String,
        expected_revision: u64,
        force: bool,
        password: Option<String>,
    ) -> AppResult<NoteUpdateResult> {
        self.ensure_note_summary_index()?;
        let txn = self.db.begin_write().map_err(storage_error)?;
        let folders = read_note_folders_in_txn(&txn)?;
        let notes = read_note_summaries_in_txn(&txn)?;
        let mut note = read_note_in_txn(&txn, note_id)?
            .ok_or_else(|| AppError::Config(format!("Note '{note_id}' does not exist")))?;
        if !force && note.revision != expected_revision {
            return Err(AppError::Config(format!(
                "Revision conflict: expected {}, found {}",
                expected_revision, note.revision
            )));
        }

        let title = normalize_note_name(&title)?;
        validate_unique_sibling_name(
            &folders,
            &notes,
            note.parent_id.as_deref(),
            &title,
            Some(("note", note_id)),
        )?;

        let tree_changed = note.title != title;
        let content_changed = if note.encrypted {
            let password = password.ok_or_else(|| {
                AppError::Config("Password required to update an encrypted note".to_string())
            })?;
            let meta = note.encryption.as_ref().ok_or_else(|| {
                AppError::Config("Encrypted note is missing encryption metadata".to_string())
            })?;
            let current_markdown = crate::core::note_crypto::decrypt_markdown(meta, &password)?;
            let changed = note.title != title || current_markdown != markdown;
            if changed {
                let next_meta = crate::core::note_crypto::encrypt_markdown(
                    &markdown,
                    &password,
                    meta.root_folder_id.clone(),
                )?;
                note.title = title;
                note.markdown = String::new();
                note.encryption = Some(next_meta);
                note.revision = note.revision.saturating_add(1);
                note.updated_at_ms = current_time_ms();
                write_note_in_txn(&txn, &note)?;
                write_note_summary_in_txn(&txn, &NoteSummary::from(note.clone()))?;
            }
            changed
        } else {
            let changed = note.title != title || note.markdown != markdown;
            if changed {
                note.title = title;
                note.markdown = markdown;
                note.revision = note.revision.saturating_add(1);
                note.updated_at_ms = current_time_ms();
                write_note_in_txn(&txn, &note)?;
                write_note_summary_in_txn(&txn, &NoteSummary::from(note.clone()))?;
            }
            changed
        };
        txn.commit().map_err(storage_error)?;
        Ok(NoteUpdateResult {
            note,
            changed: content_changed,
            tree_changed,
        })
    }

    pub fn rename_note_node(
        &self,
        node_kind: &str,
        node_id: &str,
        name: String,
    ) -> AppResult<NoteNodeChange> {
        self.ensure_note_summary_index()?;
        let txn = self.db.begin_write().map_err(storage_error)?;
        let folders = read_note_folders_in_txn(&txn)?;
        let notes = read_note_summaries_in_txn(&txn)?;
        let name = normalize_note_name(&name)?;
        let change = match node_kind {
            "folder" => {
                let Some(mut folder) = folders.iter().find(|item| item.id == node_id).cloned()
                else {
                    return Err(AppError::Config(format!(
                        "Folder '{node_id}' does not exist"
                    )));
                };
                validate_unique_sibling_name(
                    &folders,
                    &notes,
                    folder.parent_id.as_deref(),
                    &name,
                    Some(("folder", node_id)),
                )?;
                let changed = folder.name != name;
                if changed {
                    folder.name = name;
                    folder.updated_at_ms = current_time_ms();
                    write_note_folder_in_txn(&txn, &folder)?;
                }
                NoteNodeChange {
                    changed,
                    tree_changed: changed,
                    folder: Some(folder),
                    note: None,
                }
            }
            "note" => {
                let summary = notes
                    .iter()
                    .find(|item| item.id == node_id)
                    .ok_or_else(|| AppError::Config(format!("Note '{node_id}' does not exist")))?;
                validate_unique_sibling_name(
                    &folders,
                    &notes,
                    summary.parent_id.as_deref(),
                    &name,
                    Some(("note", node_id)),
                )?;
                let mut note = read_note_in_txn(&txn, node_id)?
                    .ok_or_else(|| AppError::Config(format!("Note '{node_id}' does not exist")))?;
                let changed = note.title != name;
                if note.title != name {
                    note.title = name;
                    note.revision = note.revision.saturating_add(1);
                    note.updated_at_ms = current_time_ms();
                    write_note_in_txn(&txn, &note)?;
                    write_note_summary_in_txn(&txn, &NoteSummary::from(note.clone()))?;
                }
                NoteNodeChange {
                    changed,
                    tree_changed: changed,
                    folder: None,
                    note: Some(NoteSummary::from(note)),
                }
            }
            _ => return Err(AppError::Config("Invalid note node kind".to_string())),
        };
        txn.commit().map_err(storage_error)?;
        Ok(change)
    }

    pub fn move_note_node(
        &self,
        node_kind: &str,
        node_id: &str,
        parent_id: Option<String>,
        sort_order: i64,
        encryption_action: Option<&str>,
        source_password: Option<&str>,
        target_password: Option<&str>,
    ) -> AppResult<NoteNodeChange> {
        self.ensure_note_summary_index()?;
        let txn = self.db.begin_write().map_err(storage_error)?;
        let folders = read_note_folders_in_txn(&txn)?;
        let notes = read_note_summaries_in_txn(&txn)?;
        validate_parent_exists(&folders, parent_id.as_deref())?;
        let action = parse_move_encryption_action(encryption_action)?;
        let target_root = encryption_root_id_for_parent(&folders, parent_id.as_deref());

        let change = match node_kind {
            "folder" => {
                let Some(mut folder) = folders.iter().find(|item| item.id == node_id).cloned()
                else {
                    return Err(AppError::Config(format!(
                        "Folder '{node_id}' does not exist"
                    )));
                };
                if parent_id.as_deref() == Some(node_id) {
                    return Err(AppError::Config(
                        "A folder cannot be moved into itself".to_string(),
                    ));
                }
                if let Some(parent_id) = parent_id.as_deref() {
                    validate_not_descendant_folder(&folders, node_id, parent_id)?;
                }
                validate_unique_sibling_name(
                    &folders,
                    &notes,
                    parent_id.as_deref(),
                    &folder.name,
                    Some(("folder", node_id)),
                )?;

                let source_root = folder_encryption_root_id(&folder);
                let encryption_changed = apply_folder_move_encryption(
                    &txn,
                    &folders,
                    &mut folder,
                    source_root.as_deref(),
                    target_root.as_deref(),
                    action,
                    source_password,
                    target_password,
                )?;

                let location_changed =
                    folder.parent_id != parent_id || folder.sort_order != sort_order;
                if location_changed {
                    folder.parent_id = parent_id;
                    folder.sort_order = sort_order;
                    folder.updated_at_ms = current_time_ms();
                }
                if location_changed || encryption_changed {
                    write_note_folder_in_txn(&txn, &folder)?;
                }
                NoteNodeChange {
                    changed: location_changed || encryption_changed,
                    tree_changed: location_changed || encryption_changed,
                    folder: Some(folder),
                    note: None,
                }
            }
            "note" => {
                let summary = notes
                    .iter()
                    .find(|item| item.id == node_id)
                    .ok_or_else(|| AppError::Config(format!("Note '{node_id}' does not exist")))?;
                validate_unique_sibling_name(
                    &folders,
                    &notes,
                    parent_id.as_deref(),
                    &summary.title,
                    Some(("note", node_id)),
                )?;
                let mut note = read_note_in_txn(&txn, node_id)?
                    .ok_or_else(|| AppError::Config(format!("Note '{node_id}' does not exist")))?;
                let source_root = note
                    .encryption
                    .as_ref()
                    .and_then(|meta| meta.root_folder_id.clone());
                let encryption_changed = apply_note_move_encryption(
                    &mut note,
                    source_root.as_deref(),
                    target_root.as_deref(),
                    action,
                    source_password,
                    target_password,
                )?;
                let location_changed = note.parent_id != parent_id || note.sort_order != sort_order;
                if location_changed {
                    note.parent_id = parent_id;
                    note.sort_order = sort_order;
                }
                if location_changed || encryption_changed {
                    note.revision = note.revision.saturating_add(1);
                    note.updated_at_ms = current_time_ms();
                    write_note_in_txn(&txn, &note)?;
                    write_note_summary_in_txn(&txn, &NoteSummary::from(note.clone()))?;
                }
                NoteNodeChange {
                    changed: location_changed || encryption_changed,
                    tree_changed: location_changed || encryption_changed,
                    folder: None,
                    note: Some(NoteSummary::from(note)),
                }
            }
            _ => return Err(AppError::Config("Invalid note node kind".to_string())),
        };
        txn.commit().map_err(storage_error)?;
        Ok(change)
    }

    pub fn delete_note_node(
        &self,
        node_kind: &str,
        node_id: &str,
    ) -> AppResult<DeleteNoteNodeResult> {
        self.ensure_note_summary_index()?;
        let txn = self.db.begin_write().map_err(storage_error)?;
        let folders = read_note_folders_in_txn(&txn)?;
        let notes = read_note_summaries_in_txn(&txn)?;
        let mut folder_ids = HashSet::new();
        let mut note_ids = HashSet::new();

        match node_kind {
            "folder" => {
                if !folders.iter().any(|folder| folder.id == node_id) {
                    return Err(AppError::Config(format!(
                        "Folder '{node_id}' does not exist"
                    )));
                }
                collect_descendant_folder_ids(&folders, node_id, &mut folder_ids);
                folder_ids.insert(node_id.to_string());
                for note in &notes {
                    if note
                        .parent_id
                        .as_ref()
                        .is_some_and(|parent| folder_ids.contains(parent))
                    {
                        note_ids.insert(note.id.clone());
                    }
                }
            }
            "note" => {
                if !notes.iter().any(|note| note.id == node_id) {
                    return Err(AppError::Config(format!("Note '{node_id}' does not exist")));
                }
                note_ids.insert(node_id.to_string());
            }
            _ => return Err(AppError::Config("Invalid note node kind".to_string())),
        }

        {
            let mut folder_table = txn.open_table(NOTE_FOLDERS_TABLE).map_err(storage_error)?;
            for id in &folder_ids {
                folder_table
                    .remove(entity_key(NOTE_FOLDER_PREFIX, id).as_str())
                    .map_err(storage_error)?;
            }
        }
        {
            let mut note_table = txn.open_table(NOTES_TABLE).map_err(storage_error)?;
            for id in &note_ids {
                note_table
                    .remove(entity_key(NOTE_DOCUMENT_PREFIX, id).as_str())
                    .map_err(storage_error)?;
            }
        }
        {
            let mut summary_table = txn
                .open_table(NOTE_SUMMARIES_TABLE)
                .map_err(storage_error)?;
            for id in &note_ids {
                summary_table
                    .remove(entity_key(NOTE_SUMMARY_PREFIX, id).as_str())
                    .map_err(storage_error)?;
            }
        }
        txn.commit().map_err(storage_error)?;
        let folder_count = folder_ids.len();
        let note_count = note_ids.len();
        let mut ids = folder_ids.into_iter().chain(note_ids).collect::<Vec<_>>();
        ids.sort();
        Ok(DeleteNoteNodeResult {
            folder_count,
            note_count,
            ids,
        })
    }

    pub fn load_notes_snapshot(&self) -> AppResult<NotesSnapshot> {
        Ok(NotesSnapshot {
            folders: self.list_note_folders()?,
            notes: self.list_notes()?,
        })
    }

    pub fn replace_notes_snapshot(&self, snapshot: &NotesSnapshot) -> AppResult<()> {
        validate_notes_snapshot(snapshot)?;
        let txn = self.db.begin_write().map_err(storage_error)?;
        clear_prefix_in_txn(&txn, NOTE_FOLDERS_TABLE, NOTE_FOLDER_PREFIX)?;
        clear_prefix_in_txn(&txn, NOTES_TABLE, NOTE_DOCUMENT_PREFIX)?;
        clear_prefix_in_txn(&txn, NOTE_SUMMARIES_TABLE, NOTE_SUMMARY_PREFIX)?;
        for folder in &snapshot.folders {
            write_note_folder_in_txn(&txn, folder)?;
        }
        for note in &snapshot.notes {
            write_note_in_txn(&txn, note)?;
            write_note_summary_in_txn(&txn, &NoteSummary::from(note.clone()))?;
        }
        write_meta_u32(
            &txn,
            META_NOTE_SUMMARY_INDEX_VERSION,
            NOTE_SUMMARY_INDEX_VERSION,
        )?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }

    pub fn unlock_note(&self, note_id: &str, password: &str) -> AppResult<NoteDocument> {
        let mut note = self
            .get_note(note_id)?
            .ok_or_else(|| AppError::Config(format!("Note '{note_id}' does not exist")))?;
        if !note.encrypted {
            return Ok(note);
        }
        let meta = note.encryption.as_ref().ok_or_else(|| {
            AppError::Config("Encrypted note is missing encryption metadata".to_string())
        })?;
        note.markdown = crate::core::note_crypto::decrypt_markdown(meta, password)?;
        Ok(note)
    }

    pub fn verify_folder_password(&self, folder_id: &str, password: &str) -> AppResult<bool> {
        let folders = self.list_note_folders()?;
        let root = find_encryption_root(&folders, folder_id)?;
        let meta = root.encryption.as_ref().ok_or_else(|| {
            AppError::Config("Encrypted folder is missing encryption metadata".to_string())
        })?;
        let verifier = meta.verifier.as_deref().ok_or_else(|| {
            AppError::Config("Encrypted folder root is missing password verifier".to_string())
        })?;
        crate::core::note_crypto::verify_folder_password(password, verifier)
    }

    pub fn encrypt_note(&self, note_id: &str, password: &str) -> AppResult<NoteDocument> {
        self.ensure_note_summary_index()?;
        let txn = self.db.begin_write().map_err(storage_error)?;
        let mut note = read_note_in_txn(&txn, note_id)?
            .ok_or_else(|| AppError::Config(format!("Note '{note_id}' does not exist")))?;
        if note.encrypted {
            return Err(AppError::Config("Note is already encrypted".to_string()));
        }
        let meta = crate::core::note_crypto::encrypt_markdown(&note.markdown, password, None)?;
        note.markdown = String::new();
        note.encrypted = true;
        note.encryption = Some(meta);
        note.revision = note.revision.saturating_add(1);
        note.updated_at_ms = current_time_ms();
        write_note_in_txn(&txn, &note)?;
        write_note_summary_in_txn(&txn, &NoteSummary::from(note.clone()))?;
        txn.commit().map_err(storage_error)?;
        Ok(note)
    }

    pub fn decrypt_note(&self, note_id: &str, password: &str) -> AppResult<NoteDocument> {
        self.ensure_note_summary_index()?;
        let txn = self.db.begin_write().map_err(storage_error)?;
        let mut note = read_note_in_txn(&txn, note_id)?
            .ok_or_else(|| AppError::Config(format!("Note '{note_id}' does not exist")))?;
        if !note.encrypted {
            return Err(AppError::Config("Note is not encrypted".to_string()));
        }
        if note
            .encryption
            .as_ref()
            .and_then(|meta| meta.root_folder_id.as_ref())
            .is_some()
        {
            return Err(AppError::Config(
                "Note belongs to an encrypted folder; decrypt the folder instead".to_string(),
            ));
        }
        let meta = note.encryption.as_ref().ok_or_else(|| {
            AppError::Config("Encrypted note is missing encryption metadata".to_string())
        })?;
        let plaintext = crate::core::note_crypto::decrypt_markdown(meta, password)?;
        note.markdown = plaintext;
        note.encrypted = false;
        note.encryption = None;
        note.revision = note.revision.saturating_add(1);
        note.updated_at_ms = current_time_ms();
        write_note_in_txn(&txn, &note)?;
        write_note_summary_in_txn(&txn, &NoteSummary::from(note.clone()))?;
        txn.commit().map_err(storage_error)?;
        Ok(note)
    }

    pub fn change_note_password(
        &self,
        note_id: &str,
        old_password: &str,
        new_password: &str,
    ) -> AppResult<NoteDocument> {
        self.ensure_note_summary_index()?;
        let txn = self.db.begin_write().map_err(storage_error)?;
        let mut note = read_note_in_txn(&txn, note_id)?
            .ok_or_else(|| AppError::Config(format!("Note '{note_id}' does not exist")))?;
        if !note.encrypted {
            return Err(AppError::Config("Note is not encrypted".to_string()));
        }
        let meta = note.encryption.as_ref().ok_or_else(|| {
            AppError::Config("Encrypted note is missing encryption metadata".to_string())
        })?;
        let next = crate::core::note_crypto::reencrypt_markdown(
            meta,
            old_password,
            new_password,
            meta.root_folder_id.clone(),
        )?;
        note.encryption = Some(next);
        note.revision = note.revision.saturating_add(1);
        note.updated_at_ms = current_time_ms();
        write_note_in_txn(&txn, &note)?;
        write_note_summary_in_txn(&txn, &NoteSummary::from(note.clone()))?;
        txn.commit().map_err(storage_error)?;
        Ok(note)
    }

    pub fn encrypt_note_folder(&self, folder_id: &str, password: &str) -> AppResult<NoteFolder> {
        self.ensure_note_summary_index()?;
        let txn = self.db.begin_write().map_err(storage_error)?;
        let folders = read_note_folders_in_txn(&txn)?;
        let notes = read_notes_in_txn(&txn)?;
        let mut folder = folders
            .iter()
            .find(|item| item.id == folder_id)
            .cloned()
            .ok_or_else(|| AppError::Config(format!("Folder '{folder_id}' does not exist")))?;
        if folder.encrypted {
            return Err(AppError::Config("folder_already_encrypted".to_string()));
        }
        if folder_is_inside_encrypted_tree(&folders, folder_id) {
            return Err(AppError::Config(
                "Folder is already inside an encrypted folder tree".to_string(),
            ));
        }

        let (salt, verifier) = crate::core::note_crypto::create_folder_verifier(password)?;
        folder.encrypted = true;
        folder.encryption = Some(crate::config::FolderEncryptionMeta {
            root_folder_id: None,
            salt: Some(salt),
            verifier: Some(verifier),
        });
        folder.updated_at_ms = current_time_ms();
        write_note_folder_in_txn(&txn, &folder)?;

        let mut descendant_folder_ids = HashSet::new();
        collect_descendant_folder_ids(&folders, folder_id, &mut descendant_folder_ids);
        for child in folders.iter().filter(|item| descendant_folder_ids.contains(&item.id)) {
            let mut child = child.clone();
            child.encrypted = true;
            child.encryption = Some(crate::config::FolderEncryptionMeta {
                root_folder_id: Some(folder_id.to_string()),
                salt: None,
                verifier: None,
            });
            child.updated_at_ms = current_time_ms();
            write_note_folder_in_txn(&txn, &child)?;
        }

        let mut all_folder_ids = descendant_folder_ids;
        all_folder_ids.insert(folder_id.to_string());
        for note in notes {
            let belongs = note
                .parent_id
                .as_ref()
                .is_some_and(|parent| all_folder_ids.contains(parent));
            if !belongs {
                continue;
            }
            if note.encrypted {
                // Already encrypted independently — cannot re-bind without old password.
                return Err(AppError::Config(format!(
                    "note_already_encrypted:{}",
                    note.title
                )));
            }
            let mut note = note;
            let meta = crate::core::note_crypto::encrypt_markdown(
                &note.markdown,
                password,
                Some(folder_id.to_string()),
            )?;
            note.markdown = String::new();
            note.encrypted = true;
            note.encryption = Some(meta);
            note.revision = note.revision.saturating_add(1);
            note.updated_at_ms = current_time_ms();
            write_note_in_txn(&txn, &note)?;
            write_note_summary_in_txn(&txn, &NoteSummary::from(note))?;
        }

        txn.commit().map_err(storage_error)?;
        Ok(folder)
    }

    pub fn decrypt_note_folder(&self, folder_id: &str, password: &str) -> AppResult<NoteFolder> {
        self.ensure_note_summary_index()?;
        let txn = self.db.begin_write().map_err(storage_error)?;
        let folders = read_note_folders_in_txn(&txn)?;
        let notes = read_notes_in_txn(&txn)?;
        let root = find_encryption_root_from_list(&folders, folder_id)?;
        if root.id != folder_id {
            return Err(AppError::Config(
                "Only the encrypted folder root can be decrypted".to_string(),
            ));
        }
        let meta = root.encryption.as_ref().ok_or_else(|| {
            AppError::Config("Encrypted folder is missing encryption metadata".to_string())
        })?;
        let verifier = meta.verifier.as_deref().ok_or_else(|| {
            AppError::Config("Encrypted folder root is missing password verifier".to_string())
        })?;
        if !crate::core::note_crypto::verify_folder_password(password, verifier)? {
            return Err(AppError::Crypto("wrong_password".into()));
        }

        let mut descendant_folder_ids = HashSet::new();
        collect_descendant_folder_ids(&folders, folder_id, &mut descendant_folder_ids);
        let mut all_folder_ids = descendant_folder_ids.clone();
        all_folder_ids.insert(folder_id.to_string());

        for note in notes {
            let belongs = note
                .parent_id
                .as_ref()
                .is_some_and(|parent| all_folder_ids.contains(parent));
            if !belongs || !note.encrypted {
                continue;
            }
            let meta = note.encryption.as_ref().ok_or_else(|| {
                AppError::Config("Encrypted note is missing encryption metadata".to_string())
            })?;
            let plaintext = crate::core::note_crypto::decrypt_markdown(meta, password)?;
            let mut note = note;
            note.markdown = plaintext;
            note.encrypted = false;
            note.encryption = None;
            note.revision = note.revision.saturating_add(1);
            note.updated_at_ms = current_time_ms();
            write_note_in_txn(&txn, &note)?;
            write_note_summary_in_txn(&txn, &NoteSummary::from(note))?;
        }

        for child_id in &descendant_folder_ids {
            if let Some(mut child) = folders.iter().find(|item| &item.id == child_id).cloned() {
                child.encrypted = false;
                child.encryption = None;
                child.updated_at_ms = current_time_ms();
                write_note_folder_in_txn(&txn, &child)?;
            }
        }

        let mut folder = root.clone();
        folder.encrypted = false;
        folder.encryption = None;
        folder.updated_at_ms = current_time_ms();
        write_note_folder_in_txn(&txn, &folder)?;
        txn.commit().map_err(storage_error)?;
        Ok(folder)
    }

    pub fn change_folder_password(
        &self,
        folder_id: &str,
        old_password: &str,
        new_password: &str,
    ) -> AppResult<NoteFolder> {
        self.ensure_note_summary_index()?;
        let txn = self.db.begin_write().map_err(storage_error)?;
        let folders = read_note_folders_in_txn(&txn)?;
        let notes = read_notes_in_txn(&txn)?;
        let root = find_encryption_root_from_list(&folders, folder_id)?;
        if root.id != folder_id {
            return Err(AppError::Config(
                "Only the encrypted folder root password can be changed".to_string(),
            ));
        }
        let meta = root.encryption.as_ref().ok_or_else(|| {
            AppError::Config("Encrypted folder is missing encryption metadata".to_string())
        })?;
        let verifier = meta.verifier.as_deref().ok_or_else(|| {
            AppError::Config("Encrypted folder root is missing password verifier".to_string())
        })?;
        if !crate::core::note_crypto::verify_folder_password(old_password, verifier)? {
            return Err(AppError::Crypto("wrong_password".into()));
        }

        let mut descendant_folder_ids = HashSet::new();
        collect_descendant_folder_ids(&folders, folder_id, &mut descendant_folder_ids);
        let mut all_folder_ids = descendant_folder_ids;
        all_folder_ids.insert(folder_id.to_string());

        for note in notes {
            let belongs = note
                .parent_id
                .as_ref()
                .is_some_and(|parent| all_folder_ids.contains(parent));
            if !belongs || !note.encrypted {
                continue;
            }
            let meta = note.encryption.as_ref().ok_or_else(|| {
                AppError::Config("Encrypted note is missing encryption metadata".to_string())
            })?;
            let next = crate::core::note_crypto::reencrypt_markdown(
                meta,
                old_password,
                new_password,
                meta.root_folder_id.clone(),
            )?;
            let mut note = note;
            note.encryption = Some(next);
            note.revision = note.revision.saturating_add(1);
            note.updated_at_ms = current_time_ms();
            write_note_in_txn(&txn, &note)?;
            write_note_summary_in_txn(&txn, &NoteSummary::from(note))?;
        }

        let (salt, verifier) = crate::core::note_crypto::create_folder_verifier(new_password)?;
        let mut folder = root.clone();
        folder.encryption = Some(crate::config::FolderEncryptionMeta {
            root_folder_id: None,
            salt: Some(salt),
            verifier: Some(verifier),
        });
        folder.updated_at_ms = current_time_ms();
        write_note_folder_in_txn(&txn, &folder)?;
        txn.commit().map_err(storage_error)?;
        Ok(folder)
    }

    fn ensure_note_summary_index(&self) -> AppResult<()> {
        if self.note_summary_index_version()? >= NOTE_SUMMARY_INDEX_VERSION {
            return Ok(());
        }

        let txn = self.db.begin_write().map_err(storage_error)?;
        let current_version =
            read_meta_u32_in_txn(&txn, META_NOTE_SUMMARY_INDEX_VERSION)?.unwrap_or(0);
        open_note_summary_table_in_txn(&txn)?;
        if current_version >= NOTE_SUMMARY_INDEX_VERSION {
            txn.commit().map_err(storage_error)?;
            return Ok(());
        }

        clear_prefix_in_txn(&txn, NOTE_SUMMARIES_TABLE, NOTE_SUMMARY_PREFIX)?;
        for note in read_notes_in_txn(&txn)? {
            write_note_summary_in_txn(&txn, &NoteSummary::from(note))?;
        }
        write_meta_u32(
            &txn,
            META_NOTE_SUMMARY_INDEX_VERSION,
            NOTE_SUMMARY_INDEX_VERSION,
        )?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }

    fn note_summary_index_version(&self) -> AppResult<u32> {
        let txn = self.db.begin_read().map_err(storage_error)?;
        let table = match txn.open_table(META_TABLE) {
            Ok(table) => table,
            Err(redb::TableError::TableDoesNotExist(_)) => return Ok(0),
            Err(error) => return Err(storage_error(error)),
        };
        let Some(raw) = table
            .get(META_NOTE_SUMMARY_INDEX_VERSION)
            .map_err(storage_error)?
        else {
            return Ok(0);
        };
        parse_meta_u32(raw.value(), META_NOTE_SUMMARY_INDEX_VERSION)
    }
}

fn read_note_folders_in_txn(txn: &redb::WriteTransaction) -> AppResult<Vec<NoteFolder>> {
    let table = txn.open_table(NOTE_FOLDERS_TABLE).map_err(storage_error)?;
    let mut folders = Vec::new();
    for entry in table.iter().map_err(storage_error)? {
        let (key, value) = entry.map_err(storage_error)?;
        if key.value().starts_with(NOTE_FOLDER_PREFIX) {
            folders.push(deserialize_json::<NoteFolder>(value.value())?);
        }
    }
    sort_note_folders(&mut folders);
    Ok(folders)
}

fn read_notes_in_txn(txn: &redb::WriteTransaction) -> AppResult<Vec<NoteDocument>> {
    let table = txn.open_table(NOTES_TABLE).map_err(storage_error)?;
    let mut notes = Vec::new();
    for entry in table.iter().map_err(storage_error)? {
        let (key, value) = entry.map_err(storage_error)?;
        if key.value().starts_with(NOTE_DOCUMENT_PREFIX) {
            notes.push(deserialize_json::<NoteDocument>(value.value())?);
        }
    }
    sort_notes(&mut notes);
    Ok(notes)
}

fn read_note_summaries_in_txn(txn: &redb::WriteTransaction) -> AppResult<Vec<NoteSummary>> {
    let table = txn
        .open_table(NOTE_SUMMARIES_TABLE)
        .map_err(storage_error)?;
    let mut notes = Vec::new();
    for entry in table.iter().map_err(storage_error)? {
        let (key, value) = entry.map_err(storage_error)?;
        if key.value().starts_with(NOTE_SUMMARY_PREFIX) {
            notes.push(deserialize_json::<NoteSummary>(value.value())?);
        }
    }
    sort_note_summaries(&mut notes);
    Ok(notes)
}

fn read_note_in_txn(
    txn: &redb::WriteTransaction,
    note_id: &str,
) -> AppResult<Option<NoteDocument>> {
    let table = txn.open_table(NOTES_TABLE).map_err(storage_error)?;
    let key = entity_key(NOTE_DOCUMENT_PREFIX, note_id);
    table
        .get(key.as_str())
        .map_err(storage_error)?
        .map(|value| deserialize_json::<NoteDocument>(value.value()))
        .transpose()
}

fn write_note_folder_in_txn(txn: &redb::WriteTransaction, folder: &NoteFolder) -> AppResult<()> {
    write_json_in_txn(
        txn,
        NOTE_FOLDERS_TABLE,
        &entity_key(NOTE_FOLDER_PREFIX, &folder.id),
        folder,
    )
}

fn write_note_in_txn(txn: &redb::WriteTransaction, note: &NoteDocument) -> AppResult<()> {
    write_json_in_txn(
        txn,
        NOTES_TABLE,
        &entity_key(NOTE_DOCUMENT_PREFIX, &note.id),
        note,
    )
}

fn write_note_summary_in_txn(txn: &redb::WriteTransaction, note: &NoteSummary) -> AppResult<()> {
    write_json_in_txn(
        txn,
        NOTE_SUMMARIES_TABLE,
        &entity_key(NOTE_SUMMARY_PREFIX, &note.id),
        note,
    )
}

fn open_note_summary_table_in_txn(txn: &redb::WriteTransaction) -> AppResult<()> {
    txn.open_table(NOTE_SUMMARIES_TABLE)
        .map_err(storage_error)?;
    Ok(())
}

fn normalize_note_name(raw: &str) -> AppResult<String> {
    let value = raw.trim();
    if value.is_empty() {
        return Err(AppError::Config("Note name cannot be empty".to_string()));
    }
    if value.chars().count() > MAX_NOTE_NAME_CHARS {
        return Err(AppError::Config(format!(
            "Note name cannot exceed {MAX_NOTE_NAME_CHARS} characters"
        )));
    }
    if value.contains('/') || value.contains('\\') {
        return Err(AppError::Config(
            "Note name cannot contain '/' or '\\'".to_string(),
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(AppError::Config(
            "Note name cannot contain control characters".to_string(),
        ));
    }
    Ok(value.to_string())
}

fn normalize_or_unique_name(
    raw: Option<String>,
    fallback: &str,
    sibling_names: &HashSet<String>,
) -> AppResult<String> {
    if let Some(raw) = raw {
        let name = normalize_note_name(&raw)?;
        if sibling_names.contains(&name.to_lowercase()) {
            return Err(AppError::Config(format!(
                "A note item named '{name}' already exists in this folder"
            )));
        }
        return Ok(name);
    }

    let base = normalize_note_name(fallback)?;
    if !sibling_names.contains(&base.to_lowercase()) {
        return Ok(base);
    }
    for index in 2..10_000 {
        let candidate = format!("{base} {index}");
        if !sibling_names.contains(&candidate.to_lowercase()) {
            return Ok(candidate);
        }
    }
    Err(AppError::Config(
        "Could not generate a unique note name".to_string(),
    ))
}

fn sibling_names(
    folders: &[NoteFolder],
    notes: &[impl NoteListItem],
    parent_id: Option<&str>,
    exclude: Option<(&str, &str)>,
) -> HashSet<String> {
    let mut names = HashSet::new();
    for folder in folders {
        if folder.parent_id.as_deref() != parent_id
            || exclude == Some(("folder", folder.id.as_str()))
        {
            continue;
        }
        names.insert(folder.name.to_lowercase());
    }
    for note in notes {
        if note.parent_id() != parent_id || exclude == Some(("note", note.id())) {
            continue;
        }
        names.insert(note.title().to_lowercase());
    }
    names
}

fn validate_unique_sibling_name(
    folders: &[NoteFolder],
    notes: &[impl NoteListItem],
    parent_id: Option<&str>,
    name: &str,
    exclude: Option<(&str, &str)>,
) -> AppResult<()> {
    if sibling_names(folders, notes, parent_id, exclude).contains(&name.to_lowercase()) {
        return Err(AppError::Config(format!(
            "A note item named '{name}' already exists in this folder"
        )));
    }
    Ok(())
}

fn validate_parent_exists(folders: &[NoteFolder], parent_id: Option<&str>) -> AppResult<()> {
    if let Some(parent_id) = parent_id {
        if !folders.iter().any(|folder| folder.id == parent_id) {
            return Err(AppError::Config(format!(
                "Folder '{parent_id}' does not exist"
            )));
        }
    }
    Ok(())
}

fn validate_not_descendant_folder(
    folders: &[NoteFolder],
    source_id: &str,
    target_parent_id: &str,
) -> AppResult<()> {
    let by_id: HashMap<&str, &NoteFolder> = folders
        .iter()
        .map(|folder| (folder.id.as_str(), folder))
        .collect();
    let mut current = Some(target_parent_id);
    let mut visited = HashSet::new();
    while let Some(folder_id) = current {
        if folder_id == source_id {
            return Err(AppError::Config(
                "A folder cannot be moved into its descendant".to_string(),
            ));
        }
        if !visited.insert(folder_id) {
            return Err(AppError::Config(
                "Folder hierarchy contains a cycle".to_string(),
            ));
        }
        current = by_id
            .get(folder_id)
            .and_then(|folder| folder.parent_id.as_deref());
    }
    Ok(())
}

fn inherit_folder_encryption(
    folders: &[NoteFolder],
    parent_id: Option<&str>,
) -> (bool, Option<crate::config::FolderEncryptionMeta>) {
    let Some(root_id) = encryption_root_id_for_parent(folders, parent_id) else {
        return (false, None);
    };
    (
        true,
        Some(crate::config::FolderEncryptionMeta {
            root_folder_id: Some(root_id),
            salt: None,
            verifier: None,
        }),
    )
}

fn encryption_root_id_for_parent(
    folders: &[NoteFolder],
    parent_id: Option<&str>,
) -> Option<String> {
    let parent_id = parent_id?;
    let by_id: HashMap<&str, &NoteFolder> = folders
        .iter()
        .map(|folder| (folder.id.as_str(), folder))
        .collect();
    let mut current = by_id.get(parent_id).copied()?;
    loop {
        if current.encrypted {
            if let Some(root_id) = current
                .encryption
                .as_ref()
                .and_then(|meta| meta.root_folder_id.clone())
            {
                return Some(root_id);
            }
            return Some(current.id.clone());
        }
        current = current
            .parent_id
            .as_deref()
            .and_then(|id| by_id.get(id).copied())?;
    }
}

fn find_encryption_root_from_list<'a>(
    folders: &'a [NoteFolder],
    folder_id: &str,
) -> AppResult<&'a NoteFolder> {
    let by_id: HashMap<&str, &NoteFolder> = folders
        .iter()
        .map(|folder| (folder.id.as_str(), folder))
        .collect();
    let mut current = by_id.get(folder_id).copied().ok_or_else(|| {
        AppError::Config(format!("Folder '{folder_id}' does not exist"))
    })?;
    if !current.encrypted {
        return Err(AppError::Config(format!(
            "Folder '{folder_id}' is not encrypted"
        )));
    }
    loop {
        if let Some(root_id) = current
            .encryption
            .as_ref()
            .and_then(|meta| meta.root_folder_id.as_deref())
        {
            current = by_id.get(root_id).copied().ok_or_else(|| {
                AppError::Config(format!("Encryption root folder '{root_id}' does not exist"))
            })?;
            continue;
        }
        return Ok(current);
    }
}

fn find_encryption_root(folders: &[NoteFolder], folder_id: &str) -> AppResult<NoteFolder> {
    find_encryption_root_from_list(folders, folder_id).map(|folder| folder.clone())
}

fn folder_is_inside_encrypted_tree(folders: &[NoteFolder], folder_id: &str) -> bool {
    let by_id: HashMap<&str, &NoteFolder> = folders
        .iter()
        .map(|folder| (folder.id.as_str(), folder))
        .collect();
    let mut current = by_id.get(folder_id).and_then(|folder| folder.parent_id.as_deref());
    let mut visited = HashSet::new();
    while let Some(id) = current {
        if !visited.insert(id) {
            break;
        }
        let Some(folder) = by_id.get(id) else {
            break;
        };
        if folder.encrypted {
            return true;
        }
        current = folder.parent_id.as_deref();
    }
    false
}

fn collect_descendant_folder_ids(
    folders: &[NoteFolder],
    parent_id: &str,
    collected: &mut HashSet<String>,
) {
    for folder in folders {
        if folder.parent_id.as_deref() == Some(parent_id) && collected.insert(folder.id.clone()) {
            collect_descendant_folder_ids(folders, &folder.id, collected);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MoveEncryptionAction {
    None,
    KeepStandalone,
    Decrypt,
    Rebind,
}

fn parse_move_encryption_action(raw: Option<&str>) -> AppResult<MoveEncryptionAction> {
    match raw {
        None | Some("") | Some("plain") | Some("none") => Ok(MoveEncryptionAction::None),
        Some("keep") => Ok(MoveEncryptionAction::KeepStandalone),
        Some("decrypt") => Ok(MoveEncryptionAction::Decrypt),
        Some("rebind") => Ok(MoveEncryptionAction::Rebind),
        Some(other) => Err(AppError::Config(format!(
            "Invalid move encryption action '{other}'"
        ))),
    }
}

fn folder_encryption_root_id(folder: &NoteFolder) -> Option<String> {
    if !folder.encrypted {
        return None;
    }
    folder
        .encryption
        .as_ref()
        .and_then(|meta| meta.root_folder_id.clone())
        .or_else(|| Some(folder.id.clone()))
}

fn require_password<'a>(password: Option<&'a str>, label: &str) -> AppResult<&'a str> {
    password
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Config(format!("password_required:{label}")))
}

fn apply_note_move_encryption(
    note: &mut NoteDocument,
    source_root: Option<&str>,
    target_root: Option<&str>,
    action: MoveEncryptionAction,
    source_password: Option<&str>,
    target_password: Option<&str>,
) -> AppResult<bool> {
    // Standalone encrypted note moving between non-encrypted parents: no crypto change.
    if note.encrypted && source_root.is_none() && target_root.is_none() {
        return Ok(false);
    }

    // Unencrypted note staying outside encrypted trees.
    if !note.encrypted && target_root.is_none() {
        return Ok(false);
    }

    // Same encrypted tree: only relocate.
    if note.encrypted
        && source_root.is_some()
        && target_root.is_some()
        && source_root == target_root
    {
        return Ok(false);
    }

    // Leaving an encrypted folder tree → keep standalone or decrypt.
    if note.encrypted && source_root.is_some() && target_root.is_none() {
        let password = require_password(source_password, "source")?;
        let meta = note.encryption.as_ref().ok_or_else(|| {
            AppError::Config("Encrypted note is missing encryption metadata".to_string())
        })?;
        match action {
            MoveEncryptionAction::KeepStandalone => {
                let plaintext = crate::core::note_crypto::decrypt_markdown(meta, password)?;
                let next =
                    crate::core::note_crypto::encrypt_markdown(&plaintext, password, None)?;
                note.markdown = String::new();
                note.encryption = Some(next);
                return Ok(true);
            }
            MoveEncryptionAction::Decrypt => {
                let plaintext = crate::core::note_crypto::decrypt_markdown(meta, password)?;
                note.markdown = plaintext;
                note.encrypted = false;
                note.encryption = None;
                return Ok(true);
            }
            _ => {
                return Err(AppError::Config(
                    "encryption_action_required:keep_or_decrypt".to_string(),
                ));
            }
        }
    }

    // Entering / switching into an encrypted folder tree.
    if let Some(target_id) = target_root {
        let target_pwd = require_password(target_password, "target")?;
        if !note.encrypted {
            let meta = crate::core::note_crypto::encrypt_markdown(
                &note.markdown,
                target_pwd,
                Some(target_id.to_string()),
            )?;
            note.markdown = String::new();
            note.encrypted = true;
            note.encryption = Some(meta);
            return Ok(true);
        }

        let source_pwd = require_password(source_password, "source")?;
        let meta = note.encryption.as_ref().ok_or_else(|| {
            AppError::Config("Encrypted note is missing encryption metadata".to_string())
        })?;
        let next = crate::core::note_crypto::reencrypt_markdown(
            meta,
            source_pwd,
            target_pwd,
            Some(target_id.to_string()),
        )?;
        note.encryption = Some(next);
        note.markdown = String::new();
        note.encrypted = true;
        return Ok(true);
    }

    Err(AppError::Config("encryption_action_required".to_string()))
}

fn apply_folder_move_encryption(
    txn: &redb::WriteTransaction,
    folders: &[NoteFolder],
    folder: &mut NoteFolder,
    source_root: Option<&str>,
    target_root: Option<&str>,
    action: MoveEncryptionAction,
    source_password: Option<&str>,
    target_password: Option<&str>,
) -> AppResult<bool> {
    let folder_id = folder.id.clone();
    let is_enc_root = folder.encrypted
        && folder
            .encryption
            .as_ref()
            .and_then(|meta| meta.root_folder_id.as_ref())
            .is_none();

    // Unencrypted folder staying outside encrypted trees.
    if !folder.encrypted && target_root.is_none() {
        return Ok(false);
    }

    // Same encrypted tree relocate (child stays bound to same root).
    if let (Some(src), Some(tgt)) = (source_root, target_root) {
        if src == tgt {
            return Ok(false);
        }
    }

    // Encrypted root moving to a non-encrypted parent: keep = plain relocate; decrypt = unlock tree.
    if is_enc_root && target_root.is_none() {
        match action {
            MoveEncryptionAction::None | MoveEncryptionAction::KeepStandalone => {
                return Ok(false);
            }
            MoveEncryptionAction::Decrypt => {
                let password = require_password(source_password, "source")?;
                decrypt_folder_tree_in_txn(txn, folders, &folder_id, password)?;
                folder.encrypted = false;
                folder.encryption = None;
                return Ok(true);
            }
            MoveEncryptionAction::Rebind => {
                return Err(AppError::Config(
                    "Cannot rebind encrypted folder root without a target encrypted folder"
                        .to_string(),
                ));
            }
        }
    }

    // Child of encrypted tree moving outside.
    if folder.encrypted && source_root.is_some() && !is_enc_root && target_root.is_none() {
        let password = require_password(source_password, "source")?;
        match action {
            MoveEncryptionAction::KeepStandalone => {
                promote_folder_to_encryption_root_in_txn(
                    txn, folders, folder, password,
                )?;
                return Ok(true);
            }
            MoveEncryptionAction::Decrypt => {
                decrypt_folder_subtree_notes_in_txn(txn, folders, &folder_id, password)?;
                clear_folder_subtree_encryption_in_txn(txn, folders, &folder_id)?;
                folder.encrypted = false;
                folder.encryption = None;
                return Ok(true);
            }
            _ => {
                return Err(AppError::Config(
                    "encryption_action_required:keep_or_decrypt".to_string(),
                ));
            }
        }
    }

    // Entering / switching into a target encrypted tree.
    if let Some(target_id) = target_root {
        let target_pwd = require_password(target_password, "target")?;
        if !folder.encrypted {
            bind_plain_folder_to_encrypted_root_in_txn(
                txn, folders, folder, target_id, target_pwd,
            )?;
            return Ok(true);
        }

        let source_pwd = require_password(source_password, "source")?;
        let source_root_id = source_root
            .map(|id| id.to_string())
            .unwrap_or_else(|| folder.id.clone());
        // Moving encrypted folder (root or child) into another encrypted tree.
        rebind_encrypted_folder_to_target_in_txn(
            txn,
            folders,
            folder,
            &source_root_id,
            target_id,
            source_pwd,
            target_pwd,
        )?;
        return Ok(true);
    }

    Ok(false)
}

fn subtree_folder_ids(folders: &[NoteFolder], root_id: &str) -> HashSet<String> {
    let mut ids = HashSet::new();
    collect_descendant_folder_ids(folders, root_id, &mut ids);
    ids.insert(root_id.to_string());
    ids
}

fn decrypt_folder_tree_in_txn(
    txn: &redb::WriteTransaction,
    folders: &[NoteFolder],
    folder_id: &str,
    password: &str,
) -> AppResult<()> {
    let root = find_encryption_root_from_list(folders, folder_id)?;
    if root.id != folder_id {
        return Err(AppError::Config(
            "Only the encrypted folder root can be decrypted".to_string(),
        ));
    }
    let meta = root.encryption.as_ref().ok_or_else(|| {
        AppError::Config("Encrypted folder is missing encryption metadata".to_string())
    })?;
    let verifier = meta.verifier.as_deref().ok_or_else(|| {
        AppError::Config("Encrypted folder root is missing password verifier".to_string())
    })?;
    if !crate::core::note_crypto::verify_folder_password(password, verifier)? {
        return Err(AppError::Crypto("wrong_password".into()));
    }
    decrypt_folder_subtree_notes_in_txn(txn, folders, folder_id, password)?;
    clear_folder_subtree_encryption_in_txn(txn, folders, folder_id)?;
    Ok(())
}

fn decrypt_folder_subtree_notes_in_txn(
    txn: &redb::WriteTransaction,
    folders: &[NoteFolder],
    folder_id: &str,
    password: &str,
) -> AppResult<()> {
    let all_folder_ids = subtree_folder_ids(folders, folder_id);
    let notes = read_notes_in_txn(txn)?;
    for note in notes {
        let belongs = note
            .parent_id
            .as_ref()
            .is_some_and(|parent| all_folder_ids.contains(parent));
        if !belongs || !note.encrypted {
            continue;
        }
        let meta = note.encryption.as_ref().ok_or_else(|| {
            AppError::Config("Encrypted note is missing encryption metadata".to_string())
        })?;
        let plaintext = crate::core::note_crypto::decrypt_markdown(meta, password)?;
        let mut note = note;
        note.markdown = plaintext;
        note.encrypted = false;
        note.encryption = None;
        note.revision = note.revision.saturating_add(1);
        note.updated_at_ms = current_time_ms();
        write_note_in_txn(txn, &note)?;
        write_note_summary_in_txn(txn, &NoteSummary::from(note))?;
    }
    Ok(())
}

fn clear_folder_subtree_encryption_in_txn(
    txn: &redb::WriteTransaction,
    folders: &[NoteFolder],
    folder_id: &str,
) -> AppResult<()> {
    let mut descendant_folder_ids = HashSet::new();
    collect_descendant_folder_ids(folders, folder_id, &mut descendant_folder_ids);
    for child_id in &descendant_folder_ids {
        if let Some(mut child) = folders.iter().find(|item| &item.id == child_id).cloned() {
            child.encrypted = false;
            child.encryption = None;
            child.updated_at_ms = current_time_ms();
            write_note_folder_in_txn(txn, &child)?;
        }
    }
    Ok(())
}

fn promote_folder_to_encryption_root_in_txn(
    txn: &redb::WriteTransaction,
    folders: &[NoteFolder],
    folder: &mut NoteFolder,
    password: &str,
) -> AppResult<()> {
    let folder_id = folder.id.clone();
    let all_folder_ids = subtree_folder_ids(folders, &folder_id);
    // Verify password against any note (or we could verify by decrypting one note).
    let notes = read_notes_in_txn(txn)?;
    let mut verified = false;
    for note in &notes {
        let belongs = note
            .parent_id
            .as_ref()
            .is_some_and(|parent| all_folder_ids.contains(parent));
        if !belongs || !note.encrypted {
            continue;
        }
        let meta = note.encryption.as_ref().ok_or_else(|| {
            AppError::Config("Encrypted note is missing encryption metadata".to_string())
        })?;
        // Validate password once.
        let _ = crate::core::note_crypto::decrypt_markdown(meta, password)?;
        verified = true;
        break;
    }
    if !verified {
        // Empty subtree — still require password to create verifier consistently.
        if password.is_empty() {
            return Err(AppError::Config("password_required:source".to_string()));
        }
    }

    let (salt, verifier) = crate::core::note_crypto::create_folder_verifier(password)?;
    folder.encrypted = true;
    folder.encryption = Some(crate::config::FolderEncryptionMeta {
        root_folder_id: None,
        salt: Some(salt),
        verifier: Some(verifier),
    });
    folder.updated_at_ms = current_time_ms();

    for child in folders
        .iter()
        .filter(|item| all_folder_ids.contains(&item.id) && item.id != folder_id)
    {
        let mut child = child.clone();
        child.encrypted = true;
        child.encryption = Some(crate::config::FolderEncryptionMeta {
            root_folder_id: Some(folder_id.clone()),
            salt: None,
            verifier: None,
        });
        child.updated_at_ms = current_time_ms();
        write_note_folder_in_txn(txn, &child)?;
    }

    for note in notes {
        let belongs = note
            .parent_id
            .as_ref()
            .is_some_and(|parent| all_folder_ids.contains(parent));
        if !belongs || !note.encrypted {
            continue;
        }
        let meta = note.encryption.as_ref().ok_or_else(|| {
            AppError::Config("Encrypted note is missing encryption metadata".to_string())
        })?;
        // Same password: only rebind root_folder_id.
        let next = crate::core::note_crypto::reencrypt_markdown(
            meta,
            password,
            password,
            Some(folder_id.clone()),
        )?;
        let mut note = note;
        note.encryption = Some(next);
        note.revision = note.revision.saturating_add(1);
        note.updated_at_ms = current_time_ms();
        write_note_in_txn(txn, &note)?;
        write_note_summary_in_txn(txn, &NoteSummary::from(note))?;
    }
    Ok(())
}

fn bind_plain_folder_to_encrypted_root_in_txn(
    txn: &redb::WriteTransaction,
    folders: &[NoteFolder],
    folder: &mut NoteFolder,
    target_root_id: &str,
    target_password: &str,
) -> AppResult<()> {
    let folder_id = folder.id.clone();
    let all_folder_ids = subtree_folder_ids(folders, &folder_id);

    folder.encrypted = true;
    folder.encryption = Some(crate::config::FolderEncryptionMeta {
        root_folder_id: Some(target_root_id.to_string()),
        salt: None,
        verifier: None,
    });
    folder.updated_at_ms = current_time_ms();

    for child in folders
        .iter()
        .filter(|item| all_folder_ids.contains(&item.id) && item.id != folder_id)
    {
        let mut child = child.clone();
        child.encrypted = true;
        child.encryption = Some(crate::config::FolderEncryptionMeta {
            root_folder_id: Some(target_root_id.to_string()),
            salt: None,
            verifier: None,
        });
        child.updated_at_ms = current_time_ms();
        write_note_folder_in_txn(txn, &child)?;
    }

    let notes = read_notes_in_txn(txn)?;
    for note in notes {
        let belongs = note
            .parent_id
            .as_ref()
            .is_some_and(|parent| all_folder_ids.contains(parent));
        if !belongs {
            continue;
        }
        if note.encrypted {
            return Err(AppError::Config(format!(
                "note_already_encrypted:{}",
                note.title
            )));
        }
        let meta = crate::core::note_crypto::encrypt_markdown(
            &note.markdown,
            target_password,
            Some(target_root_id.to_string()),
        )?;
        let mut note = note;
        note.markdown = String::new();
        note.encrypted = true;
        note.encryption = Some(meta);
        note.revision = note.revision.saturating_add(1);
        note.updated_at_ms = current_time_ms();
        write_note_in_txn(txn, &note)?;
        write_note_summary_in_txn(txn, &NoteSummary::from(note))?;
    }
    Ok(())
}

fn rebind_encrypted_folder_to_target_in_txn(
    txn: &redb::WriteTransaction,
    folders: &[NoteFolder],
    folder: &mut NoteFolder,
    source_root_id: &str,
    target_root_id: &str,
    source_password: &str,
    target_password: &str,
) -> AppResult<()> {
    let folder_id = folder.id.clone();
    let all_folder_ids = subtree_folder_ids(folders, &folder_id);

    // If moving an encryption root, verify against its verifier.
    if let Some(root) = folders.iter().find(|item| item.id == source_root_id) {
        if let Some(verifier) = root
            .encryption
            .as_ref()
            .and_then(|meta| meta.verifier.as_deref())
        {
            if !crate::core::note_crypto::verify_folder_password(source_password, verifier)? {
                return Err(AppError::Crypto("wrong_password".into()));
            }
        }
    }
    if let Some(target) = folders.iter().find(|item| item.id == target_root_id) {
        if let Some(verifier) = target
            .encryption
            .as_ref()
            .and_then(|meta| meta.verifier.as_deref())
        {
            if !crate::core::note_crypto::verify_folder_password(target_password, verifier)? {
                return Err(AppError::Crypto("wrong_password".into()));
            }
        }
    }

    folder.encrypted = true;
    folder.encryption = Some(crate::config::FolderEncryptionMeta {
        root_folder_id: Some(target_root_id.to_string()),
        salt: None,
        verifier: None,
    });
    folder.updated_at_ms = current_time_ms();

    for child in folders
        .iter()
        .filter(|item| all_folder_ids.contains(&item.id) && item.id != folder_id)
    {
        let mut child = child.clone();
        child.encrypted = true;
        child.encryption = Some(crate::config::FolderEncryptionMeta {
            root_folder_id: Some(target_root_id.to_string()),
            salt: None,
            verifier: None,
        });
        child.updated_at_ms = current_time_ms();
        write_note_folder_in_txn(txn, &child)?;
    }

    let notes = read_notes_in_txn(txn)?;
    for note in notes {
        let belongs = note
            .parent_id
            .as_ref()
            .is_some_and(|parent| all_folder_ids.contains(parent));
        if !belongs {
            continue;
        }
        if !note.encrypted {
            let meta = crate::core::note_crypto::encrypt_markdown(
                &note.markdown,
                target_password,
                Some(target_root_id.to_string()),
            )?;
            let mut note = note;
            note.markdown = String::new();
            note.encrypted = true;
            note.encryption = Some(meta);
            note.revision = note.revision.saturating_add(1);
            note.updated_at_ms = current_time_ms();
            write_note_in_txn(txn, &note)?;
            write_note_summary_in_txn(txn, &NoteSummary::from(note))?;
            continue;
        }
        let meta = note.encryption.as_ref().ok_or_else(|| {
            AppError::Config("Encrypted note is missing encryption metadata".to_string())
        })?;
        let next = crate::core::note_crypto::reencrypt_markdown(
            meta,
            source_password,
            target_password,
            Some(target_root_id.to_string()),
        )?;
        let mut note = note;
        note.encryption = Some(next);
        note.revision = note.revision.saturating_add(1);
        note.updated_at_ms = current_time_ms();
        write_note_in_txn(txn, &note)?;
        write_note_summary_in_txn(txn, &NoteSummary::from(note))?;
    }
    Ok(())
}

fn next_sort_order_for_parent(
    folders: &[NoteFolder],
    notes: &[impl NoteListItem],
    parent_id: Option<&str>,
) -> i64 {
    folders
        .iter()
        .filter(|folder| folder.parent_id.as_deref() == parent_id)
        .map(|folder| folder.sort_order)
        .chain(
            notes
                .iter()
                .filter(|note| note.parent_id() == parent_id)
                .map(NoteListItem::sort_order),
        )
        .max()
        .unwrap_or(-1)
        .saturating_add(1)
}

fn validate_notes_snapshot(snapshot: &NotesSnapshot) -> AppResult<()> {
    let mut folder_ids = HashSet::new();
    let mut note_ids = HashSet::new();
    for folder in &snapshot.folders {
        normalize_note_name(&folder.name)?;
        if !folder_ids.insert(folder.id.as_str()) {
            return Err(AppError::Config(format!(
                "Duplicate note folder id '{}'",
                folder.id
            )));
        }
    }
    for note in &snapshot.notes {
        normalize_note_name(&note.title)?;
        if !note_ids.insert(note.id.as_str()) {
            return Err(AppError::Config(format!("Duplicate note id '{}'", note.id)));
        }
    }
    for folder in &snapshot.folders {
        if let Some(parent_id) = folder.parent_id.as_deref() {
            if !folder_ids.contains(parent_id) {
                return Err(AppError::Config(format!(
                    "Note folder '{}' has missing parent '{}'",
                    folder.id, parent_id
                )));
            }
            validate_not_descendant_folder(&snapshot.folders, &folder.id, parent_id)?;
        }
    }
    for note in &snapshot.notes {
        if let Some(parent_id) = note.parent_id.as_deref() {
            if !folder_ids.contains(parent_id) {
                return Err(AppError::Config(format!(
                    "Note '{}' has missing parent '{}'",
                    note.id, parent_id
                )));
            }
        }
    }
    for folder in &snapshot.folders {
        validate_unique_sibling_name(
            &snapshot.folders,
            &snapshot.notes,
            folder.parent_id.as_deref(),
            &folder.name,
            Some(("folder", &folder.id)),
        )?;
    }
    for note in &snapshot.notes {
        validate_unique_sibling_name(
            &snapshot.folders,
            &snapshot.notes,
            note.parent_id.as_deref(),
            &note.title,
            Some(("note", &note.id)),
        )?;
    }
    Ok(())
}

fn sort_note_folders(folders: &mut [NoteFolder]) {
    folders.sort_by(|left, right| {
        left.parent_id
            .cmp(&right.parent_id)
            .then(left.sort_order.cmp(&right.sort_order))
            .then(left.name.cmp(&right.name))
            .then(left.id.cmp(&right.id))
    });
}

fn sort_notes(notes: &mut [NoteDocument]) {
    notes.sort_by(|left, right| {
        left.parent_id
            .cmp(&right.parent_id)
            .then(left.sort_order.cmp(&right.sort_order))
            .then(left.title.cmp(&right.title))
            .then(left.id.cmp(&right.id))
    });
}

fn sort_note_summaries(notes: &mut [NoteSummary]) {
    notes.sort_by(|left, right| {
        left.parent_id
            .cmp(&right.parent_id)
            .then(left.sort_order.cmp(&right.sort_order))
            .then(left.title.cmp(&right.title))
            .then(left.id.cmp(&right.id))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_storage() -> Storage {
        let dir = std::env::temp_dir().join(format!(
            "nyaterm-notes-test-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        Storage::open(&dir).expect("open temp storage")
    }

    fn summary_titles(storage: &Storage) -> Vec<String> {
        storage
            .list_note_summaries()
            .expect("summaries")
            .into_iter()
            .map(|note| note.title)
            .collect()
    }

    #[test]
    fn creates_root_note_and_nested_folder() {
        let storage = temp_storage();
        let folder = storage
            .create_note_folder(None, Some("Projects".to_string()))
            .expect("create folder");
        let note = storage
            .create_note(
                Some(folder.id.clone()),
                Some("Deploy".to_string()),
                Some("# Runbook".to_string()),
                None,
            )
            .expect("create note");

        assert_eq!(note.parent_id.as_deref(), Some(folder.id.as_str()));
        assert_eq!(note.revision, 1);
        assert_eq!(storage.list_note_folders().expect("folders").len(), 1);
        assert_eq!(storage.list_notes().expect("notes").len(), 1);
        assert_eq!(summary_titles(&storage), vec!["Deploy".to_string()]);
    }

    #[test]
    fn rejects_duplicate_sibling_names_case_insensitive() {
        let storage = temp_storage();
        storage
            .create_note(None, Some("Readme".to_string()), None, None)
            .expect("create note");

        let error = storage
            .create_note_folder(None, Some("readme".to_string()))
            .expect_err("duplicate should fail");

        assert!(error.to_string().contains("already exists"));
    }

    #[test]
    fn rejects_folder_move_to_self_or_descendant() {
        let storage = temp_storage();
        let root = storage
            .create_note_folder(None, Some("Root".to_string()))
            .expect("root folder");
        let child = storage
            .create_note_folder(Some(root.id.clone()), Some("Child".to_string()))
            .expect("child folder");

        let self_error = storage
            .move_note_node("folder", &root.id, Some(root.id.clone()), 0, None, None, None)
            .expect_err("self move should fail");
        assert!(self_error.to_string().contains("itself"));

        let descendant_error = storage
            .move_note_node("folder", &root.id, Some(child.id.clone()), 0, None, None, None)
            .expect_err("descendant move should fail");
        assert!(descendant_error.to_string().contains("descendant"));
    }

    #[test]
    fn update_note_increments_revision_and_rejects_stale_revision() {
        let storage = temp_storage();
        let note = storage
            .create_note(None, Some("Draft".to_string()), Some("one".to_string()), None)
            .expect("create note");
        let updated = storage
            .update_note(
                &note.id,
                "Draft".to_string(),
                "two".to_string(),
                note.revision,
                false,
                None,
            )
            .expect("update note");
        assert_eq!(updated.note.revision, note.revision + 1);
        assert!(updated.changed);
        assert!(!updated.tree_changed);

        let error = storage
            .update_note(
                &note.id,
                "Draft".to_string(),
                "three".to_string(),
                note.revision,
                false,
                None,
            )
            .expect_err("stale update should fail");
        assert!(error.to_string().contains("Revision conflict"));
    }

    #[test]
    fn rebuilds_missing_note_summary_index_from_documents() {
        let storage = temp_storage();
        storage
            .create_note(
                None,
                Some("Indexed".to_string()),
                Some("large body".to_string()),
                None,
            )
            .expect("create note");

        let txn = storage.db.begin_write().expect("txn");
        clear_prefix_in_txn(&txn, NOTE_SUMMARIES_TABLE, NOTE_SUMMARY_PREFIX).expect("clear index");
        {
            let mut meta = txn.open_table(META_TABLE).expect("meta");
            meta.remove(META_NOTE_SUMMARY_INDEX_VERSION)
                .expect("remove meta");
        }
        txn.commit().expect("commit");

        let summaries = storage.list_note_summaries().expect("rebuild summaries");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].title, "Indexed");
        assert_eq!(summaries[0].parent_id, None);
    }

    #[test]
    fn note_mutations_keep_summary_index_in_sync() {
        let storage = temp_storage();
        let folder = storage
            .create_note_folder(None, Some("Folder".to_string()))
            .expect("folder");
        let note = storage
            .create_note(None, Some("Draft".to_string()), Some("one".to_string()), None)
            .expect("note");

        let updated = storage
            .update_note(
                &note.id,
                "Published".to_string(),
                "two".to_string(),
                note.revision,
                false,
                None,
            )
            .expect("update");
        assert!(updated.tree_changed);
        assert_eq!(summary_titles(&storage), vec!["Published".to_string()]);

        let moved = storage
            .move_note_node("note", &note.id, Some(folder.id.clone()), 42, None, None, None)
            .expect("move");
        assert!(moved.changed);
        let summary = storage
            .list_note_summaries()
            .expect("summaries")
            .into_iter()
            .find(|item| item.id == note.id)
            .expect("moved summary");
        assert_eq!(summary.parent_id.as_deref(), Some(folder.id.as_str()));
        assert_eq!(summary.sort_order, 42);

        let renamed = storage
            .rename_note_node("note", &note.id, "Final".to_string())
            .expect("rename");
        assert!(renamed.changed);
        assert_eq!(summary_titles(&storage), vec!["Final".to_string()]);
    }

    #[test]
    fn recursive_delete_removes_folder_descendants_and_notes() {
        let storage = temp_storage();
        let root = storage
            .create_note_folder(None, Some("Root".to_string()))
            .expect("root folder");
        let child = storage
            .create_note_folder(Some(root.id.clone()), Some("Child".to_string()))
            .expect("child folder");
        storage
            .create_note(Some(child.id.clone()), Some("Leaf".to_string()), None, None)
            .expect("leaf note");

        let result = storage
            .delete_note_node("folder", &root.id)
            .expect("delete folder");

        assert_eq!(result.folder_count, 2);
        assert_eq!(result.note_count, 1);
        assert!(storage.list_note_folders().expect("folders").is_empty());
        assert!(storage.list_notes().expect("notes").is_empty());
        assert!(storage.list_note_summaries().expect("summaries").is_empty());
    }

    #[test]
    fn snapshot_export_and_replace_roundtrip() {
        let storage = temp_storage();
        let folder = storage
            .create_note_folder(None, Some("Folder".to_string()))
            .expect("folder");
        storage
            .create_note(
                Some(folder.id.clone()),
                Some("Note".to_string()),
                Some("body".to_string()),
                None,
            )
            .expect("note");
        let snapshot = storage.load_notes_snapshot().expect("snapshot");

        let replacement = temp_storage();
        replacement
            .replace_notes_snapshot(&snapshot)
            .expect("replace snapshot");
        let roundtrip = replacement.load_notes_snapshot().expect("roundtrip");

        assert_eq!(roundtrip, snapshot);
        assert_eq!(
            replacement.list_note_summaries().expect("summaries").len(),
            1
        );
    }

    #[test]
    fn encrypt_decrypt_note_roundtrip() {
        let storage = temp_storage();
        let note = storage
            .create_note(None, Some("Secret".to_string()), Some("# hi".to_string()), None)
            .expect("create");
        let encrypted = storage
            .encrypt_note(&note.id, "pass-1")
            .expect("encrypt");
        assert!(encrypted.encrypted);
        assert!(encrypted.markdown.is_empty());
        assert!(encrypted.encryption.is_some());

        let unlocked = storage.unlock_note(&note.id, "pass-1").expect("unlock");
        assert_eq!(unlocked.markdown, "# hi");

        assert!(storage.unlock_note(&note.id, "wrong").is_err());

        let decrypted = storage.decrypt_note(&note.id, "pass-1").expect("decrypt");
        assert!(!decrypted.encrypted);
        assert_eq!(decrypted.markdown, "# hi");
        assert!(decrypted.encryption.is_none());
    }

    #[test]
    fn encrypt_folder_recursively_encrypts_notes() {
        let storage = temp_storage();
        let folder = storage
            .create_note_folder(None, Some("Vault".to_string()))
            .expect("folder");
        let child = storage
            .create_note_folder(Some(folder.id.clone()), Some("Inner".to_string()))
            .expect("child folder");
        let note = storage
            .create_note(
                Some(child.id.clone()),
                Some("Nested".to_string()),
                Some("body".to_string()),
                None,
            )
            .expect("note");

        let encrypted_folder = storage
            .encrypt_note_folder(&folder.id, "vault-pass")
            .expect("encrypt folder");
        assert!(encrypted_folder.encrypted);
        assert!(encrypted_folder.encryption.as_ref().unwrap().verifier.is_some());

        let child_after = storage
            .list_note_folders()
            .expect("folders")
            .into_iter()
            .find(|item| item.id == child.id)
            .expect("child");
        assert!(child_after.encrypted);
        assert_eq!(
            child_after.encryption.as_ref().unwrap().root_folder_id.as_deref(),
            Some(folder.id.as_str())
        );

        let note_after = storage.get_note(&note.id).expect("get").expect("note");
        assert!(note_after.encrypted);
        assert!(note_after.markdown.is_empty());
        assert_eq!(
            note_after
                .encryption
                .as_ref()
                .unwrap()
                .root_folder_id
                .as_deref(),
            Some(folder.id.as_str())
        );

        assert!(
            storage
                .verify_folder_password(&folder.id, "vault-pass")
                .expect("verify")
        );
        assert!(
            !storage
                .verify_folder_password(&folder.id, "wrong")
                .expect("verify wrong")
        );

        let unlocked = storage
            .unlock_note(&note.id, "vault-pass")
            .expect("unlock nested");
        assert_eq!(unlocked.markdown, "body");

        storage
            .decrypt_note_folder(&folder.id, "vault-pass")
            .expect("decrypt folder");
        let note_plain = storage.get_note(&note.id).expect("get").expect("note");
        assert!(!note_plain.encrypted);
        assert_eq!(note_plain.markdown, "body");
    }

    #[test]
    fn change_note_password_keeps_content() {
        let storage = temp_storage();
        let note = storage
            .create_note(None, Some("P".to_string()), Some("payload".to_string()), None)
            .expect("create");
        storage.encrypt_note(&note.id, "old").expect("encrypt");
        storage
            .change_note_password(&note.id, "old", "new")
            .expect("change");
        assert!(storage.unlock_note(&note.id, "old").is_err());
        let unlocked = storage.unlock_note(&note.id, "new").expect("unlock");
        assert_eq!(unlocked.markdown, "payload");
    }

    #[test]
    fn move_encrypted_note_out_keep_standalone() {
        let storage = temp_storage();
        let folder = storage
            .create_note_folder(None, Some("Vault".to_string()))
            .expect("folder");
        let note = storage
            .create_note(
                Some(folder.id.clone()),
                Some("Secret".to_string()),
                Some("body".to_string()),
                None,
            )
            .expect("note");
        storage
            .encrypt_note_folder(&folder.id, "vault-pass")
            .expect("encrypt");

        storage
            .move_note_node(
                "note",
                &note.id,
                None,
                0,
                Some("keep"),
                Some("vault-pass"),
                None,
            )
            .expect("move keep");

        let moved = storage.get_note(&note.id).expect("get").expect("note");
        assert!(moved.encrypted);
        assert!(moved.parent_id.is_none());
        assert!(
            moved
                .encryption
                .as_ref()
                .unwrap()
                .root_folder_id
                .is_none()
        );
        let unlocked = storage.unlock_note(&note.id, "vault-pass").expect("unlock");
        assert_eq!(unlocked.markdown, "body");
    }

    #[test]
    fn move_encrypted_note_out_decrypt() {
        let storage = temp_storage();
        let folder = storage
            .create_note_folder(None, Some("Vault".to_string()))
            .expect("folder");
        let note = storage
            .create_note(
                Some(folder.id.clone()),
                Some("Secret".to_string()),
                Some("body".to_string()),
                None,
            )
            .expect("note");
        storage
            .encrypt_note_folder(&folder.id, "vault-pass")
            .expect("encrypt");

        storage
            .move_note_node(
                "note",
                &note.id,
                None,
                0,
                Some("decrypt"),
                Some("vault-pass"),
                None,
            )
            .expect("move decrypt");

        let moved = storage.get_note(&note.id).expect("get").expect("note");
        assert!(!moved.encrypted);
        assert_eq!(moved.markdown, "body");
        assert!(moved.encryption.is_none());
    }

    #[test]
    fn move_note_into_other_encrypted_folder_rebinds() {
        let storage = temp_storage();
        let vault_a = storage
            .create_note_folder(None, Some("VaultA".to_string()))
            .expect("a");
        let vault_b = storage
            .create_note_folder(None, Some("VaultB".to_string()))
            .expect("b");
        let note = storage
            .create_note(
                Some(vault_a.id.clone()),
                Some("Secret".to_string()),
                Some("cross".to_string()),
                None,
            )
            .expect("note");
        storage
            .encrypt_note_folder(&vault_a.id, "pass-a")
            .expect("encrypt a");
        storage
            .encrypt_note_folder(&vault_b.id, "pass-b")
            .expect("encrypt b");

        storage
            .move_note_node(
                "note",
                &note.id,
                Some(vault_b.id.clone()),
                0,
                Some("rebind"),
                Some("pass-a"),
                Some("pass-b"),
            )
            .expect("cross move");

        let moved = storage.get_note(&note.id).expect("get").expect("note");
        assert!(moved.encrypted);
        assert_eq!(moved.parent_id.as_deref(), Some(vault_b.id.as_str()));
        assert_eq!(
            moved
                .encryption
                .as_ref()
                .unwrap()
                .root_folder_id
                .as_deref(),
            Some(vault_b.id.as_str())
        );
        assert!(storage.unlock_note(&note.id, "pass-a").is_err());
        let unlocked = storage.unlock_note(&note.id, "pass-b").expect("unlock");
        assert_eq!(unlocked.markdown, "cross");
    }

    #[test]
    fn move_within_same_encrypted_tree_no_reencrypt() {
        let storage = temp_storage();
        let vault = storage
            .create_note_folder(None, Some("Vault".to_string()))
            .expect("vault");
        let child = storage
            .create_note_folder(Some(vault.id.clone()), Some("Inner".to_string()))
            .expect("child");
        let note = storage
            .create_note(
                Some(vault.id.clone()),
                Some("N".to_string()),
                Some("same-tree".to_string()),
                None,
            )
            .expect("note");
        storage
            .encrypt_note_folder(&vault.id, "vault-pass")
            .expect("encrypt");

        let before = storage.get_note(&note.id).expect("get").expect("note");
        let before_cipher = before.encryption.as_ref().unwrap().ciphertext.clone();

        storage
            .move_note_node(
                "note",
                &note.id,
                Some(child.id.clone()),
                0,
                None,
                None,
                None,
            )
            .expect("same-tree move");

        let after = storage.get_note(&note.id).expect("get").expect("note");
        assert_eq!(after.parent_id.as_deref(), Some(child.id.as_str()));
        assert_eq!(
            after.encryption.as_ref().unwrap().ciphertext,
            before_cipher
        );
        assert_eq!(
            after
                .encryption
                .as_ref()
                .unwrap()
                .root_folder_id
                .as_deref(),
            Some(vault.id.as_str())
        );
    }

    #[test]
    fn move_encrypted_folder_out_keep_and_decrypt() {
        let storage = temp_storage();
        let vault = storage
            .create_note_folder(None, Some("Vault".to_string()))
            .expect("vault");
        let child = storage
            .create_note_folder(Some(vault.id.clone()), Some("Inner".to_string()))
            .expect("child");
        let note = storage
            .create_note(
                Some(child.id.clone()),
                Some("N".to_string()),
                Some("nested".to_string()),
                None,
            )
            .expect("note");
        storage
            .encrypt_note_folder(&vault.id, "vault-pass")
            .expect("encrypt");

        // Promote child folder out as a new encrypted root.
        storage
            .move_note_node(
                "folder",
                &child.id,
                None,
                0,
                Some("keep"),
                Some("vault-pass"),
                None,
            )
            .expect("promote keep");

        let child_after = storage
            .list_note_folders()
            .expect("folders")
            .into_iter()
            .find(|item| item.id == child.id)
            .expect("child");
        assert!(child_after.encrypted);
        assert!(child_after.parent_id.is_none());
        assert!(
            child_after
                .encryption
                .as_ref()
                .unwrap()
                .root_folder_id
                .is_none()
        );
        assert!(
            child_after
                .encryption
                .as_ref()
                .unwrap()
                .verifier
                .is_some()
        );

        let note_after = storage.get_note(&note.id).expect("get").expect("note");
        assert_eq!(
            note_after
                .encryption
                .as_ref()
                .unwrap()
                .root_folder_id
                .as_deref(),
            Some(child.id.as_str())
        );
        assert_eq!(
            storage
                .unlock_note(&note.id, "vault-pass")
                .expect("unlock")
                .markdown,
            "nested"
        );

        // Decrypt the promoted root while moving (already at root — decrypt in place via move to same parent).
        storage
            .move_note_node(
                "folder",
                &child.id,
                None,
                1,
                Some("decrypt"),
                Some("vault-pass"),
                None,
            )
            .expect("decrypt move");
        let child_plain = storage
            .list_note_folders()
            .expect("folders")
            .into_iter()
            .find(|item| item.id == child.id)
            .expect("child");
        assert!(!child_plain.encrypted);
        let note_plain = storage.get_note(&note.id).expect("get").expect("note");
        assert!(!note_plain.encrypted);
        assert_eq!(note_plain.markdown, "nested");
    }

    #[test]
    fn move_plain_note_into_encrypted_folder() {
        let storage = temp_storage();
        let vault = storage
            .create_note_folder(None, Some("Vault".to_string()))
            .expect("vault");
        storage
            .encrypt_note_folder(&vault.id, "vault-pass")
            .expect("encrypt");
        let note = storage
            .create_note(None, Some("Plain".to_string()), Some("hello".to_string()), None)
            .expect("note");

        storage
            .move_note_node(
                "note",
                &note.id,
                Some(vault.id.clone()),
                0,
                Some("rebind"),
                None,
                Some("vault-pass"),
            )
            .expect("bind");

        let moved = storage.get_note(&note.id).expect("get").expect("note");
        assert!(moved.encrypted);
        assert_eq!(
            moved
                .encryption
                .as_ref()
                .unwrap()
                .root_folder_id
                .as_deref(),
            Some(vault.id.as_str())
        );
        assert_eq!(
            storage
                .unlock_note(&note.id, "vault-pass")
                .expect("unlock")
                .markdown,
            "hello"
        );
    }
}
