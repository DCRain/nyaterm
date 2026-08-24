import { describe, expect, it, vi } from "vitest";
import {
  FINISHED_TRANSFER_RETENTION_MS,
  getPrunedTransferIds,
  MAX_RETAINED_FINISHED_TRANSFERS,
  pruneRetainedTransfers,
  type RetainableTransfer,
} from "./transferRetention";

function transfer(id: string, status: string, timestamp: number): RetainableTransfer {
  return { id, status, timestamp };
}

describe("transfer retention", () => {
  it("does not prune active, queued, or paused transfers even when they are old", () => {
    const now = 10_000_000;
    const oldTimestamp = now - FINISHED_TRANSFER_RETENTION_MS - 1;

    const prunedIds = getPrunedTransferIds(
      [
        transfer("queued", "queued", oldTimestamp),
        transfer("transferring", "transferring", oldTimestamp),
        transfer("paused", "paused", oldTimestamp),
      ],
      now,
    );

    expect(prunedIds.size).toBe(0);
  });

  it("prunes finished transfers older than the retention window", () => {
    const now = 10_000_000;
    const oldTimestamp = now - FINISHED_TRANSFER_RETENTION_MS - 1;
    const freshTimestamp = now - FINISHED_TRANSFER_RETENTION_MS + 1;

    const prunedIds = getPrunedTransferIds(
      [
        transfer("old-completed", "completed", oldTimestamp),
        transfer("old-error", "error", oldTimestamp),
        transfer("old-cancelled", "cancelled", oldTimestamp),
        transfer("fresh-completed", "completed", freshTimestamp),
      ],
      now,
    );

    expect(prunedIds).toEqual(new Set(["old-completed", "old-error", "old-cancelled"]));
  });

  it("retains only the newest finished transfers when over the count limit", () => {
    const now = 10_000_000;
    const transfers = Array.from({ length: MAX_RETAINED_FINISHED_TRANSFERS + 5 }, (_, index) =>
      transfer(`finished-${index}`, "completed", now - index),
    );

    const prunedIds = getPrunedTransferIds(transfers, now);

    expect(prunedIds.size).toBe(5);
    expect(prunedIds).toEqual(
      new Set(["finished-200", "finished-201", "finished-202", "finished-203", "finished-204"]),
    );
  });

  it("calls cleanup for each pruned transfer id", () => {
    const now = 10_000_000;
    const oldTimestamp = now - FINISHED_TRANSFER_RETENTION_MS - 1;
    const transfers = new Map([
      ["old", transfer("old", "completed", oldTimestamp)],
      ["active", transfer("active", "transferring", oldTimestamp)],
    ]);
    const cleanup = vi.fn();

    const pruned = pruneRetainedTransfers(transfers, cleanup, now);

    expect(pruned.has("old")).toBe(false);
    expect(pruned.has("active")).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledWith("old");
  });
});
