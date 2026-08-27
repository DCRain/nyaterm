import { getErrorMessage } from "@/lib/errors";

/** Map backend note-password error codes / English fallbacks to i18n keys. */
export function localizeNotePasswordError(
  error: unknown,
  t: (key: string, options?: Record<string, string>) => string,
): string {
  const raw = getErrorMessage(error).trim();
  if (!raw) return t("notes.password.wrongPassword");

  const alreadyEncrypted = raw.match(/^note_already_encrypted:(.*)$/s);
  if (alreadyEncrypted) {
    return t("notes.password.noteAlreadyEncrypted", { name: alreadyEncrypted[1] || "" });
  }

  const normalized = raw.toLowerCase();
  if (raw.startsWith("password_required:") || normalized.includes("password_required")) {
    return t("notes.password.required");
  }

  // AppError::Crypto serializes as "Crypto error: wrong_password"
  if (
    raw === "wrong_password" ||
    normalized.includes("wrong_password") ||
    normalized.includes("wrong password")
  ) {
    return t("notes.password.wrongPassword");
  }

  if (
    raw === "folder_already_encrypted" ||
    normalized.includes("folder is already encrypted") ||
    normalized.includes("already encrypted")
  ) {
    return t("notes.password.folderAlreadyEncrypted");
  }

  return raw;
}
