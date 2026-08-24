import { toast } from "sonner";
import type { ResolvedLocalDropPathEntry } from "@/components/panel/file-explorer/model";
import { sendSessionInput } from "@/lib/sessionInput";
import {
  isZmodemUploadErrorHandled,
  uploadFilesViaZmodem,
} from "@/lib/terminalZmodemUpload";
import type { SessionType } from "@/types/global";

function quoteLocalPath(path: string): string {
  if (!/[\s'"\\]/.test(path)) {
    return path;
  }
  if (path.includes("\\") || /^[A-Za-z]:/.test(path)) {
    return `"${path.replace(/"/g, '\\"')}"`;
  }
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

export function formatLocalTerminalDropInput(paths: string[]): string {
  return paths.map(quoteLocalPath).join(" ");
}

export function getTerminalDropOverlayCopy(
  sessionType: SessionType,
  t: (key: string) => string,
  options?: { source?: "external" | "explorer" },
): { title: string; hint: string } {
  if (options?.source === "explorer") {
    return {
      title: t("terminal.dropOverlayTitleExplorer"),
      hint: t("terminal.dropOverlayHintExplorer"),
    };
  }

  switch (sessionType) {
    case "Local":
      return {
        title: t("terminal.dropOverlayTitleLocal"),
        hint: t("terminal.dropOverlayHintLocal"),
      };
    case "SSH":
    case "Telnet":
    case "Serial":
      return {
        title: t("terminal.dropOverlayTitleUpload"),
        hint: t("terminal.dropOverlayHintZmodem"),
      };
  }
}

export async function handleTerminalFileDrop(params: {
  sessionId: string;
  sessionType: SessionType;
  entries: ResolvedLocalDropPathEntry[];
  t: (key: string) => string;
  duplicateStrategy?: string;
}): Promise<void> {
  const { sessionId, sessionType, entries, t, duplicateStrategy = "ask" } = params;
  if (entries.length === 0) {
    return;
  }

  const fileEntries = entries.filter((entry) => !entry.isDir);
  const hasDirectories = entries.some((entry) => entry.isDir);

  if (sessionType === "Local") {
    await sendSessionInput(
      sessionId,
      formatLocalTerminalDropInput(entries.map((entry) => entry.path)),
    );
    return;
  }

  // SSH / Telnet / Serial: ZMODEM only, no folder support.
  if (hasDirectories) {
    toast.error(t("terminal.dropFoldersZmodemOnly"));
    return;
  }

  if (fileEntries.length === 0) {
    return;
  }

  await uploadFilesViaZmodem(
    sessionId,
    fileEntries.map((entry) => entry.path),
    duplicateStrategy,
  ).catch((error) => {
    if (!isZmodemUploadErrorHandled(error)) {
      toast.error(t("terminal.dropUploadFailed"));
    }
    throw error;
  });
}
