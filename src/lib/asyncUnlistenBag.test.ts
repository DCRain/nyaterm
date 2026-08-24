import { describe, expect, it, vi } from "vitest";
import { createAsyncUnlistenBag, type UnlistenFn } from "./asyncUnlistenBag";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("createAsyncUnlistenBag", () => {
  it("unlistens late registrations when disposed before the promise resolves", async () => {
    const bag = createAsyncUnlistenBag();
    const registration = deferred<UnlistenFn>();
    const unlisten = vi.fn();

    bag.add(registration.promise);
    bag.dispose();
    registration.resolve(unlisten);
    await registration.promise;
    await Promise.resolve();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("unlistens resolved registrations exactly once on dispose", async () => {
    const bag = createAsyncUnlistenBag();
    const unlisten = vi.fn();

    bag.add(Promise.resolve(unlisten));
    await Promise.resolve();
    bag.dispose();
    bag.dispose();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
