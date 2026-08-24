import { beforeEach, describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("logger queue bounds", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("drops old entries and emits a summary when log persistence is stalled", async () => {
    const firstFlush = deferred<void>();
    const appendFrontendLogs = vi
      .fn()
      .mockImplementationOnce(() => firstFlush.promise)
      .mockResolvedValue(undefined);

    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: appendFrontendLogs,
    }));

    const { logger } = await import("./logger");

    for (let index = 0; index < 1200; index += 1) {
      logger.info({
        domain: "app.lifecycle",
        event: "test.entry",
        message: `entry ${index}`,
      });
    }

    expect(appendFrontendLogs).toHaveBeenCalledTimes(1);
    firstFlush.resolve();
    for (let index = 0; index < 10; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const persistedEntries = appendFrontendLogs.mock.calls.flatMap(
      ([, args]) => (args as { entries: Array<{ event: string }> }).entries,
    );
    expect(persistedEntries.length).toBeLessThan(1200);
    expect(persistedEntries.some((entry) => entry.event === "logger.queue_overflow")).toBe(true);
  });
});
