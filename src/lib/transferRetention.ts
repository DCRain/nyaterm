export const MAX_RETAINED_FINISHED_TRANSFERS = 200;
export const FINISHED_TRANSFER_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface RetainableTransfer {
  id: string;
  status: string;
  timestamp: number;
}

const FINISHED_TRANSFER_STATUSES = new Set(["completed", "error", "cancelled"]);

export function isFinishedTransferStatus(status: string) {
  return FINISHED_TRANSFER_STATUSES.has(status);
}

export function getPrunedTransferIds(transfers: Iterable<RetainableTransfer>, now = Date.now()) {
  const finished = Array.from(transfers).filter((transfer) =>
    isFinishedTransferStatus(transfer.status),
  );
  const cutoff = now - FINISHED_TRANSFER_RETENTION_MS;
  const pruneIds = new Set<string>();
  const retainedCandidates: RetainableTransfer[] = [];

  for (const transfer of finished) {
    if (transfer.timestamp < cutoff) {
      pruneIds.add(transfer.id);
    } else {
      retainedCandidates.push(transfer);
    }
  }

  retainedCandidates.sort((a, b) => b.timestamp - a.timestamp);
  for (const transfer of retainedCandidates.slice(MAX_RETAINED_FINISHED_TRANSFERS)) {
    pruneIds.add(transfer.id);
  }

  return pruneIds;
}

export function pruneRetainedTransfers<T extends RetainableTransfer>(
  transferMap: Map<string, T>,
  cleanup: (id: string) => void,
  now = Date.now(),
) {
  const prunedIds = getPrunedTransferIds(transferMap.values(), now);
  if (prunedIds.size === 0) return transferMap;

  const next = new Map(transferMap);
  for (const id of prunedIds) {
    cleanup(id);
    next.delete(id);
  }
  return next;
}
