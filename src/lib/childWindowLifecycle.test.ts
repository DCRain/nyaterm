import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  getCurrentWindow: vi.fn(() => ({ label: "file-preview-main" })),
}));

vi.mock("@tauri-apps/api/event", () => ({ emit: mocks.emit }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: mocks.getCurrentWindow }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.emit.mockResolvedValue(undefined);
  window.history.replaceState({}, "", "/?window=file-preview&readyToken=token");
});

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
