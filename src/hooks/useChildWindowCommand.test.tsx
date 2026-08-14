import { render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { CHILD_WINDOW_COMMANDS } from "@/lib/childWindowProtocol";
import { useChildWindowCommand } from "./useChildWindowCommand";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  signalReady: vi.fn(),
  signalFailed: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@/lib/childWindowLifecycle", () => ({
  signalChildWindowCommandReady: mocks.signalReady,
  signalChildWindowLoadFailed: mocks.signalFailed,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Probe({ handler = vi.fn() }: { handler?: (payload: { tab: string }) => void }) {
  useChildWindowCommand(CHILD_WINDOW_COMMANDS.settingsOpenTab, handler);
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signalReady.mockResolvedValue(undefined);
  mocks.signalFailed.mockResolvedValue(undefined);
});

it("signals ready only after the active StrictMode listener resolves", async () => {
  const first = deferred<() => void>();
  const second = deferred<() => void>();
  const disposeFirst = vi.fn();
  const disposeSecond = vi.fn();
  mocks.listen.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

  render(
    <StrictMode>
      <Probe />
    </StrictMode>,
  );

  first.resolve(disposeFirst);
  await waitFor(() => expect(disposeFirst).toHaveBeenCalledOnce());
  expect(mocks.signalReady).not.toHaveBeenCalled();

  second.resolve(disposeSecond);
  await waitFor(() => expect(mocks.signalReady).toHaveBeenCalledOnce());
});

it("uses the latest handler without registering another Tauri listener", async () => {
  const listener = deferred<() => void>();
  const firstHandler = vi.fn();
  const secondHandler = vi.fn();
  mocks.listen.mockReturnValueOnce(listener.promise);

  const view = render(<Probe handler={firstHandler} />);
  listener.resolve(vi.fn());
  await waitFor(() => expect(mocks.signalReady).toHaveBeenCalledOnce());

  view.rerender(<Probe handler={secondHandler} />);
  const receive = mocks.listen.mock.calls[0][1];
  receive({ payload: { tab: "appearance" } });

  expect(firstHandler).not.toHaveBeenCalled();
  expect(secondHandler).toHaveBeenCalledWith({ tab: "appearance" });
  expect(mocks.listen).toHaveBeenCalledOnce();
});

it("reports listener registration failures without signaling ready", async () => {
  mocks.listen.mockRejectedValueOnce(new Error("listen failed"));

  render(<Probe />);

  await waitFor(() => expect(mocks.signalFailed).toHaveBeenCalledWith("command-listener"));
  expect(mocks.signalReady).not.toHaveBeenCalled();
});
