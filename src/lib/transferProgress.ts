export type TransferProgressKind = "file" | "directory";
export type TransferProgressStatus =
  | "queued"
  | "transferring"
  | "paused"
  | "completed"
  | "error"
  | "cancelled";

export interface TransferProgressInput {
  kind: TransferProgressKind;
  status: TransferProgressStatus;
  bytesTransferred: number;
  totalSize: number;
  size?: number;
  itemCountTotal?: number;
  itemCountCompleted?: number;
}

/** Prefer the largest known total so a later 0 tick cannot wipe an earlier size. */
export function resolveTransferTotalSize(
  existingTotal: number,
  incomingTotal: number,
  bytesTransferred: number,
  completed: boolean,
): number {
  const candidates = [existingTotal, incomingTotal];
  if (completed) {
    candidates.push(bytesTransferred);
  }
  return Math.max(0, ...candidates);
}

export function computeTransferProgressPercent(item: TransferProgressInput): number {
  const hasByteProgress = item.totalSize > 0;
  const byteProgress = hasByteProgress
    ? Math.min(100, Math.round((item.bytesTransferred / item.totalSize) * 100))
    : 0;

  if (item.kind === "directory") {
    if (hasByteProgress) {
      return byteProgress;
    }
    if (item.itemCountTotal && item.itemCountTotal > 0) {
      return Math.min(
        100,
        Math.round(((item.itemCountCompleted ?? 0) / item.itemCountTotal) * 100),
      );
    }
    return item.status === "completed" ? 100 : 0;
  }

  if (item.status === "completed") {
    return 100;
  }
  return byteProgress;
}

export function shouldShowTransferProgressBar(item: TransferProgressInput): boolean {
  if (item.status !== "transferring" && item.status !== "paused") {
    return false;
  }
  if (item.kind === "directory") {
    return item.totalSize > 0 || (item.itemCountTotal ?? 0) > 0;
  }
  return item.totalSize > 0 || item.bytesTransferred > 0;
}

export function isIndeterminateTransferProgress(item: TransferProgressInput): boolean {
  return (
    item.kind !== "directory" &&
    item.totalSize === 0 &&
    item.bytesTransferred > 0 &&
    (item.status === "transferring" || item.status === "paused")
  );
}

/** Late progress must not revive a paused/cancelled transfer in the UI. */
export function shouldApplyTransferProgress(status: TransferProgressStatus): boolean {
  return status !== "paused" && status !== "cancelled";
}
