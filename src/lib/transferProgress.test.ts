import { describe, expect, it } from "vitest";
import {
  computeTransferProgressPercent,
  isIndeterminateTransferProgress,
  resolveTransferTotalSize,
  shouldApplyTransferProgress,
  shouldShowTransferProgressBar,
} from "./transferProgress";

describe("resolveTransferTotalSize", () => {
  it("keeps the larger known total and ignores a later zero", () => {
    expect(resolveTransferTotalSize(100, 0, 40, false)).toBe(100);
    expect(resolveTransferTotalSize(0, 80, 40, false)).toBe(80);
  });

  it("uses bytes transferred when completed with unknown total", () => {
    expect(resolveTransferTotalSize(0, 0, 42, true)).toBe(42);
  });
});

describe("computeTransferProgressPercent", () => {
  it("returns 100 for completed files even when total is unknown", () => {
    expect(
      computeTransferProgressPercent({
        kind: "file",
        status: "completed",
        bytesTransferred: 42,
        totalSize: 0,
      }),
    ).toBe(100);
  });

  it("computes byte percent for files with known total", () => {
    expect(
      computeTransferProgressPercent({
        kind: "file",
        status: "transferring",
        bytesTransferred: 25,
        totalSize: 100,
      }),
    ).toBe(25);
  });

  it("uses item counts for directories without byte totals", () => {
    expect(
      computeTransferProgressPercent({
        kind: "directory",
        status: "transferring",
        bytesTransferred: 0,
        totalSize: 0,
        itemCountCompleted: 1,
        itemCountTotal: 4,
      }),
    ).toBe(25);
  });
});

describe("shouldApplyTransferProgress", () => {
  it("ignores progress while paused or cancelled so resume stays enabled", () => {
    expect(shouldApplyTransferProgress("paused")).toBe(false);
    expect(shouldApplyTransferProgress("cancelled")).toBe(false);
    expect(shouldApplyTransferProgress("transferring")).toBe(true);
    expect(shouldApplyTransferProgress("queued")).toBe(true);
  });
});

describe("progress bar visibility", () => {
  it("shows an indeterminate bar when bytes grow without a total", () => {
    const item = {
      kind: "file" as const,
      status: "transferring" as const,
      bytesTransferred: 1024,
      totalSize: 0,
    };
    expect(shouldShowTransferProgressBar(item)).toBe(true);
    expect(isIndeterminateTransferProgress(item)).toBe(true);
  });
});
