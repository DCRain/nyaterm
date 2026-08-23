import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  getCurrentWindow: vi.fn(() => ({ label: "file-preview-main" })),
}));

vi.mock("@tauri-apps/api/event", () => ({ emit: mocks.emit }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: mocks.getCurrentWindow }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
  mocks.emit.mockResolvedValue(undefined);
  window.history.replaceState({}, "", "/?window=file-preview&readyToken=token");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createRoot({
  mounted,
  width,
  height,
}: {
  mounted: boolean;
  width: number;
  height: number;
}) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById("root") as HTMLElement;
  root.getBoundingClientRect = vi.fn(
    () =>
      ({
        bottom: height,
        height,
        left: 0,
        right: width,
        top: 0,
        width,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  );
  if (mounted) root.appendChild(document.createElement("div"));
  return root;
}

function installManualAnimationFrames() {
  let nextFrameId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();

  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    callbacks.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    callbacks.delete(id);
  });

  return {
    pendingFrameCount: () => callbacks.size,
    runFrame: () => {
      const frameCallbacks = Array.from(callbacks.entries());
      callbacks.clear();
      for (const [, callback] of frameCallbacks) callback(performance.now());
    },
  };
}

function emittedPhases() {
  return mocks.emit.mock.calls.map((call) => call[1].phase);
}

it("sends load-started once before later lifecycle phases", async () => {
  const lifecycle = await import("./childWindowLifecycle");

  await Promise.all([
    lifecycle.signalChildWindowLoadStarted(),
    lifecycle.signalChildWindowLoadStarted(),
    lifecycle.signalChildWindowCommandReady("file-preview-open"),
  ]);

  expect(mocks.emit).toHaveBeenCalledTimes(2);
  expect(mocks.emit.mock.calls.map((call) => call[1])).toEqual([
    {
      label: "file-preview-main",
      token: "token",
      phase: "load-started",
    },
    {
      label: "file-preview-main",
      token: "token",
      phase: "command-ready",
      command: "file-preview-open",
    },
  ]);
});

it("allows a later lifecycle signal to retry a failed load-started emit", async () => {
  mocks.emit.mockRejectedValueOnce(new Error("emit failed")).mockResolvedValue(undefined);
  const lifecycle = await import("./childWindowLifecycle");

  await expect(lifecycle.signalChildWindowLoadStarted()).rejects.toThrow("emit failed");
  await lifecycle.signalChildWindowLoadFailed("bootstrap-import");

  expect(mocks.emit.mock.calls.map((call) => call[1].phase)).toEqual([
    "load-started",
    "load-started",
    "load-failed",
  ]);
});

it("sends shell-ready after mounted shell receives a stable layout and paints", async () => {
  vi.useFakeTimers();
  createRoot({ mounted: true, width: 320, height: 240 });
  const animationFrames = installManualAnimationFrames();
  const lifecycle = await import("./childWindowLifecycle");

  lifecycle.scheduleChildWindowShellReady();

  expect(mocks.emit).not.toHaveBeenCalled();
  expect(animationFrames.pendingFrameCount()).toBe(1);

  animationFrames.runFrame();
  expect(mocks.emit).not.toHaveBeenCalled();
  expect(animationFrames.pendingFrameCount()).toBe(1);

  animationFrames.runFrame();

  await vi.waitFor(() => expect(emittedPhases()).toEqual(["load-started", "shell-ready"]));
});

it("falls back to shell-ready when mounted hidden WebView reports zero layout", async () => {
  vi.useFakeTimers();
  createRoot({ mounted: true, width: 0, height: 0 });
  installManualAnimationFrames();
  const lifecycle = await import("./childWindowLifecycle");

  lifecycle.scheduleChildWindowShellReady();

  await vi.advanceTimersByTimeAsync(249);
  expect(mocks.emit).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1);

  await vi.waitFor(() => expect(emittedPhases()).toEqual(["load-started", "shell-ready"]));
});

it("keeps polling fallback until the shell mounts", async () => {
  vi.useFakeTimers();
  const root = createRoot({ mounted: false, width: 0, height: 0 });
  installManualAnimationFrames();
  const lifecycle = await import("./childWindowLifecycle");

  lifecycle.scheduleChildWindowShellReady();

  await vi.advanceTimersByTimeAsync(250);
  expect(mocks.emit).not.toHaveBeenCalled();

  root.appendChild(document.createElement("div"));
  await vi.advanceTimersByTimeAsync(16);

  await vi.waitFor(() => expect(emittedPhases()).toEqual(["load-started", "shell-ready"]));
});

it("emits shell-ready once when the layout path and fallback race", async () => {
  vi.useFakeTimers();
  createRoot({ mounted: true, width: 320, height: 240 });
  const animationFrames = installManualAnimationFrames();
  const lifecycle = await import("./childWindowLifecycle");

  lifecycle.scheduleChildWindowShellReady();

  await vi.advanceTimersByTimeAsync(250);
  animationFrames.runFrame();
  animationFrames.runFrame();

  await vi.waitFor(() => expect(emittedPhases()).toEqual(["load-started", "shell-ready"]));
  expect(emittedPhases().filter((phase) => phase === "shell-ready")).toHaveLength(1);
});

it("does not emit a late shell-ready after cleanup", async () => {
  vi.useFakeTimers();
  createRoot({ mounted: true, width: 0, height: 0 });
  installManualAnimationFrames();
  const lifecycle = await import("./childWindowLifecycle");

  const cleanup = lifecycle.scheduleChildWindowShellReady();
  cleanup();

  await vi.advanceTimersByTimeAsync(1_000);

  expect(mocks.emit).not.toHaveBeenCalled();
});
