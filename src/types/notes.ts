export type NoteNodeKind = "folder" | "note";

export interface NoteEncryptionMeta {
  root_folder_id?: string | null;
  salt: string;
  nonce: string;
  ciphertext: string;
}

export interface FolderEncryptionMeta {
  root_folder_id?: string | null;
  salt?: string | null;
  verifier?: string | null;
}

export interface NoteFolder {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at_ms: number;
  updated_at_ms: number;
  encrypted?: boolean;
  encryption?: FolderEncryptionMeta | null;
}

export interface NoteSummary {
  id: string;
  parent_id: string | null;
  title: string;
  sort_order: number;
  revision: number;
  created_at_ms: number;
  updated_at_ms: number;
  encrypted?: boolean;
  root_folder_id?: string | null;
}

export interface NoteDocument extends NoteSummary {
  markdown: string;
  encryption?: NoteEncryptionMeta | null;
}

export interface NoteTreePayload {
  folders: NoteFolder[];
  notes: NoteSummary[];
}

export interface NotesChangedEvent {
  kind: "created" | "updated" | "renamed" | "moved" | "deleted" | "replaced";
  nodeKind?: NoteNodeKind;
  ids: string[];
  folders?: NoteFolder[];
  notes?: NoteSummary[];
  treeChanged?: boolean;
}

export interface DeleteNoteNodeResult {
  folder_count: number;
  note_count: number;
  ids: string[];
}

export interface NoteTreeNode {
  id: string;
  kind: NoteNodeKind;
  parentId: string | null;
  name: string;
  sortOrder: number;
  revision?: number;
  updatedAtMs: number;
  encrypted?: boolean;
  rootFolderId?: string | null;
  children: NoteTreeNode[];
}
