import { join, tempDir } from "@tauri-apps/api/path";
import type { CopyEndpointRequest, TransferKind } from "@/context/TransferContext";
import { invoke } from "@/lib/invoke";

export type StorageCopyKind = CopyEndpointRequest["kind"];

function joinPosix(dir: string, name: string) {
  if (!dir || dir === "/") return `/${name}`;
  return `${dir.replace(/\/+$/, "")}/${name}`;
}

function joinLocal(dir: string, name: string) {
  const trimmed = dir.replace(/[\\/]+$/, "");
  const sep = dir.includes("\\") ? "\\" : "/";
  return trimmed ? `${trimmed}${sep}${name}` : name;
}

function canCopyNatively(source: StorageCopyKind, target: StorageCopyKind) {
  if (source === "local" || target === "local") return true;
  return source === "remote" && target === "remote";
}

async function copyLocalToStorage(
  sourcePath: string,
  target: CopyEndpointRequest,
  fileName: string,
  kind: TransferKind,
  transferId: string,
) {
  const remotePath = joinPosix(target.path, fileName);
  if (target.kind === "s3") {
    await invoke(
      kind === "directory" ? "upload_local_directory_to_s3" : "upload_local_file_to_s3",
      {
        sessionId: target.sessionId,
        localPath: sourcePath,
        remotePath,
        transferId,
      },
    );
    return;
  }
  if (target.kind === "ftp") {
    await invoke(
      kind === "directory" ? "upload_local_directory_to_ftp" : "upload_local_file_to_ftp",
      {
        sessionId: target.sessionId,
        localPath: sourcePath,
        remotePath,
        transferId,
      },
    );
    return;
  }
  if (target.kind === "webdav") {
    await invoke(
      kind === "directory" ? "upload_local_directory_to_webdav" : "upload_local_file_to_webdav",
      {
        sessionId: target.sessionId,
        localPath: sourcePath,
        remotePath,
        transferId,
      },
    );
    return;
  }

  await invoke("copy_file_entry", {
    request: {
      source: { sessionId: target.sessionId, kind: "local", path: sourcePath },
      target,
      fileName,
      isDirectory: kind === "directory",
      transferId,
    },
  });
}

async function copyStorageToLocal(
  source: CopyEndpointRequest,
  localPath: string,
  fileName: string,
  kind: TransferKind,
  transferId: string,
) {
  if (source.kind === "s3") {
    await invoke(kind === "directory" ? "download_s3_directory" : "download_s3_file", {
      sessionId: source.sessionId,
      remotePath: source.path,
      localPath,
      transferId,
    });
    return;
  }
  if (source.kind === "ftp") {
    await invoke(kind === "directory" ? "download_ftp_directory" : "download_ftp_file", {
      sessionId: source.sessionId,
      remotePath: source.path,
      localPath,
      transferId,
    });
    return;
  }
  if (source.kind === "webdav") {
    await invoke(kind === "directory" ? "download_webdav_directory" : "download_webdav_file", {
      sessionId: source.sessionId,
      remotePath: source.path,
      localPath,
      transferId,
    });
    return;
  }

  const parent = localPath.replace(/[\\/][^\\/]+$/, "") || localPath;
  await invoke("copy_file_entry", {
    request: {
      source,
      target: { sessionId: source.sessionId, kind: "local", path: parent },
      fileName,
      isDirectory: kind === "directory",
      transferId,
    },
  });
}

async function copyViaLocalStaging(
  source: CopyEndpointRequest,
  target: CopyEndpointRequest,
  fileName: string,
  kind: TransferKind,
  transferId: string,
  localSessionId: string,
) {
  const staging = await join(await tempDir(), `nyaterm-copy-${transferId}`);
  await invoke("create_local_dir", { sessionId: localSessionId, path: staging });
  const stagedPath = joinLocal(staging, fileName);
  try {
    await copyStorageToLocal(source, stagedPath, fileName, kind, transferId);
    await copyLocalToStorage(stagedPath, target, fileName, kind, transferId);
  } finally {
    await invoke("delete_local_file", { sessionId: localSessionId, path: staging }).catch(
      () => undefined,
    );
  }
}

export async function copyStorageEntry(options: {
  source: CopyEndpointRequest;
  target: CopyEndpointRequest;
  fileName: string;
  kind: TransferKind;
  transferId: string;
  duplicateStrategyOverride?: string;
}) {
  const { source, target, fileName, kind, transferId, duplicateStrategyOverride } = options;

  if (source.kind === "local" && target.kind !== "local" && target.kind !== "remote") {
    await copyLocalToStorage(source.path, target, fileName, kind, transferId);
    return;
  }
  if (target.kind === "local" && source.kind !== "local" && source.kind !== "remote") {
    await copyStorageToLocal(source, joinLocal(target.path, fileName), fileName, kind, transferId);
    return;
  }

  if (canCopyNatively(source.kind, target.kind)) {
    await invoke("copy_file_entry", {
      request: {
        source,
        target,
        fileName,
        isDirectory: kind === "directory",
        transferId,
        duplicateStrategyOverride,
      },
    });
    return;
  }

  await copyViaLocalStaging(
    source,
    target,
    fileName,
    kind,
    transferId,
    source.sessionId || target.sessionId,
  );
}
