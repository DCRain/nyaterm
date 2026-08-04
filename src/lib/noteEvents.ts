import { listen } from "@tauri-apps/api/event";
import type { NotesChangedEvent } from "@/types/notes";

export const NOTES_CHANGED_EVENT = "notes-changed";

export function listenNotesChanged(handler: (event: NotesChangedEvent) => void) {
  return listen<NotesChangedEvent>(NOTES_CHANGED_EVENT, ({ payload }) => handler(payload));
}
