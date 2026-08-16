export const NOTE_OPEN_EVENT = "nyaterm:note-open";

export interface NoteOpenDetail {
  noteId: string;
  title?: string;
}

/** Open a note in the center workspace (handled by App via openNoteTab). */
export function openNoteInWorkspace(noteId: string, title?: string) {
  window.dispatchEvent(
    new CustomEvent<NoteOpenDetail>(NOTE_OPEN_EVENT, {
      detail: { noteId, title },
    }),
  );
}
