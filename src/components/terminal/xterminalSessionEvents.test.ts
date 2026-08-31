import { describe, expect, it, vi } from "vitest";
import { replaySnapshotBeforeAttach } from "./xterminalSessionEvents";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("replaySnapshotBeforeAttach", () => {
  it("replays the snapshot before pending wake events and backend attach", async () => {
    const replay = createDeferred();
    const order: string[] = [];
    const attachSession = vi.fn(async () => {
      order.push("attach");
    });
    const restore = replaySnapshotBeforeAttach({
      initialReplayPromise: replay.promise.then(() => {
        order.push("replay");
      }),
      replayPendingWakeEvents: () => order.push("pending-wake"),
      attachSession,
    });

    await Promise.resolve();
    expect(attachSession).not.toHaveBeenCalled();
    expect(order).toEqual([]);

    replay.resolve();
    await restore;

    expect(order).toEqual(["replay", "pending-wake", "attach"]);
    expect(attachSession).toHaveBeenCalledTimes(1);
  });
});
