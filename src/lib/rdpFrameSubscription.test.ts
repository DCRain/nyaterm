import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRemoteDesktopFramePatchBuffer } from "./remoteDesktopFrame";
import { RdpFrameSubscription } from "./rdpFrameSubscription";

const { subscribe, subscriptions } = vi.hoisted(() => ({
  subscribe: vi.fn(),
  subscriptions: [] as Array<{
    frame: (buffer: ArrayBuffer) => void;
    error: (error: Error) => void;
    signal: AbortSignal;
    stop: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock("./rdpFrames", () => ({ subscribeRdpFrames: subscribe }));
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function frame(sequence: bigint, full = false) {
  return createRemoteDesktopFramePatchBuffer({
    sequence,
    desktopWidth: 2,
    desktopHeight: 1,
    x: full ? 0 : 1,
    y: 0,
    width: full ? 2 : 1,
    height: 1,
    stride: full ? 8 : 4,
    pixelFormat: "RGBA8888",
    payload: new Uint8Array(full ? 8 : 4),
  });
}

function setup(visible = true) {
  const options = {
    sessionId: "rdp-test",
    onPatch: vi.fn(),
    onReset: vi.fn(),
    onFailure: vi.fn(),
  };
  const stream = new RdpFrameSubscription(options);
  stream.start(visible);
  return { stream, ...options };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  subscriptions.length = 0;
  subscribe.mockReset().mockImplementation((_id, frame, error, signal) => {
    const stop = vi.fn();
    subscriptions.push({ frame, error, signal, stop });
    return Promise.resolve(stop);
  });
});
afterEach(() => vi.useRealTimers());

describe("RdpFrameSubscription", () => {
  it("accepts initial incremental frames, then recovers only from a full snapshot", async () => {
    const { stream, onPatch } = setup();
    subscriptions[0].frame(frame(7n));
    expect(onPatch).toHaveBeenCalledOnce();
    stream.recover("queue-overflow");
    expect(subscriptions[0].signal.aborted).toBe(true);
    subscriptions[0].frame(frame(8n));
    await vi.advanceTimersByTimeAsync(1000);
    const next = subscriptions[1];
    next.frame(frame(9n));
    expect(onPatch).toHaveBeenCalledOnce();
    next.frame(frame(10n, true));
    stream.presented();
    next.frame(frame(11n));
    next.frame(frame(10n));
    expect(onPatch.mock.calls.map(([patch]) => patch.sequence)).toEqual([
      7n,
      10n,
      11n,
    ]);
    await vi.advanceTimersByTimeAsync(6000);
    expect(subscribe).toHaveBeenCalledTimes(2);
    stream.stop();
  });

  it("detaches when hidden and requires a full frame after becoming visible again", async () => {
    const { stream, onPatch } = setup();
    subscriptions[0].frame(frame(1n));
    stream.setVisible(false);
    expect(subscriptions[0].signal.aborted).toBe(true);
    stream.setVisible(true);
    subscriptions[1].frame(frame(2n));
    expect(onPatch).toHaveBeenCalledOnce();
    subscriptions[1].frame(frame(3n, true));
    stream.presented();
    expect(onPatch).toHaveBeenCalledTimes(2);
    stream.stop();
  });

  it("resets sequence numbers on remote reconnect", async () => {
    const { stream, onPatch, onFailure } = setup();
    subscriptions[0].frame(frame(100n));
    stream.recover("render-failed");
    await vi.advanceTimersByTimeAsync(1000);
    stream.resetForReconnect();
    subscriptions[1].frame(frame(0n));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onPatch.mock.calls.map(([patch]) => patch.sequence)).toEqual([
      100n,
      0n,
    ]);
    expect(onFailure).not.toHaveBeenCalled();
    stream.stop();
  });

  it("never attaches a hidden pane and cancels work on stop", async () => {
    const { stream } = setup(false);
    expect(subscribe).not.toHaveBeenCalled();
    stream.setVisible(true);
    stream.recover("render-failed");
    stream.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(subscribe).toHaveBeenCalledOnce();
    expect(subscriptions[0].signal.aborted).toBe(true);
  });
});
