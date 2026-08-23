import i18n from "@/i18n";
import type { SavedConnection } from "@/types/global";

export function getErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return humanizeBackendError(error);
  }

  if (error instanceof Error && error.message.trim()) {
    return humanizeBackendError(error.message);
  }

  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) {
      return humanizeBackendError(message);
    }
  }

  const fallback = String(error);
  return fallback === "[object Object]" ? "Unknown error" : humanizeBackendError(fallback);
}

const WEBDAV_ERROR_KEYS: Record<string, string> = {
  "webdav:unauthorized": "error.webdavUnauthorized",
  "webdav:forbidden": "error.webdavForbidden",
  "webdav:methodNotAllowed": "error.webdavMethodNotAllowed",
  "webdav:notFound": "error.webdavNotFound",
  "webdav:unsupported": "error.webdavUnsupported",
  "webdav:failed": "error.webdavFailed",
};

function matchCodedError(raw: string, table: Record<string, string>): string | null {
  for (const [code, key] of Object.entries(table)) {
    if (raw === code || raw.endsWith(code)) {
      return i18n.t(key);
    }
  }
  return null;
}

function formatS3Failure(raw: string): string {
  const reason = extractS3FailureReason(raw);
  return reason
    ? i18n.t("error.s3OperationFailed", { reason })
    : i18n.t("error.s3Failed");
}

function extractS3FailureReason(raw: string): string {
  const coded = raw.match(/^s3:(?:unauthorized|forbidden|notFound|failed)(?::\s*)?(.*)$/i);
  if (coded) {
    return (coded[1] ?? "").trim();
  }
  const named = raw.match(
    /\b(AccessDenied|NoSuchBucket|NoSuchKey|SignatureDoesNotMatch|InvalidAccessKeyId|InvalidBucketName|AccessForbidden|RequestTimeTooSkewed)\b/,
  );
  if (named?.[1]) {
    return named[1];
  }
  const xmlCode = raw.match(/<Code>([^<]+)<\/Code>/i);
  const xmlMessage = raw.match(/<Message>([^<]+)<\/Message>/i);
  if (xmlCode?.[1] && xmlMessage?.[1]) {
    return `${xmlCode[1]}: ${xmlMessage[1]}`;
  }
  if (xmlCode?.[1]) {
    return xmlCode[1];
  }
  return (
    raw
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? raw
  );
}

export function humanizeBackendError(raw: string): string {
  let trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  if (
    /^(s3:(unauthorized|forbidden|notFound|failed)|s3 error|nosuchbucket)/i.test(trimmed) ||
    trimmed.toLowerCase().includes("service: s3")
  ) {
    return formatS3Failure(trimmed);
  }
  const webdav = matchCodedError(trimmed, WEBDAV_ERROR_KEYS);
  if (webdav) return webdav;

  const lower = trimmed.toLowerCase();
  if (lower.includes("status: 401") || lower.includes("401 unauthorized")) {
    return i18n.t("error.webdavUnauthorized");
  }
  if (lower.includes("status: 403") || lower.includes("403 forbidden")) {
    return i18n.t("error.webdavForbidden");
  }
  if (lower.includes("status: 405") || lower.includes("method not allowed")) {
    return i18n.t("error.webdavMethodNotAllowed");
  }
  if (lower.includes("status: 404") || lower.includes("404 not found")) {
    return i18n.t("error.webdavNotFound");
  }

  return trimmed;
}

const EDIT_CONNECTION_RECOVERY_PATTERNS = [
  "no ssh key for this connection",
  "no key data stored",
  "no auth config for ssh connection",
  "unknown auth type:",
  "ssh key error:",
  "password not found",
  "proxy",
  "jump host",
];

const NON_EDITOR_RECOVERY_PATTERNS = [
  "authentication failed: invalid credentials",
  "authentication failed: key rejected",
  "authentication failed: none auth rejected",
  "authentication failed for jump host",
  "none auth failed",
  "no password for this connection",
  "no stored password",
  "key auth failed:",
  "ssh authentication cancelled by user",
  "ssh authentication request dropped",
  "2fa authentication cancelled by user",
  "2fa authentication request dropped",
  "keyboard-interactive authentication failed",
  "keyboard-interactive respond failed",
];

export function shouldPromptConnectionEditOnFailure(
  connection: Pick<SavedConnection, "type"> | null | undefined,
  errorMessage: string,
): boolean {
  if (!connection || connection.type !== "ssh") {
    return false;
  }

  const normalized = errorMessage.toLowerCase();
  if (NON_EDITOR_RECOVERY_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return false;
  }

  return EDIT_CONNECTION_RECOVERY_PATTERNS.some((pattern) => normalized.includes(pattern));
}
