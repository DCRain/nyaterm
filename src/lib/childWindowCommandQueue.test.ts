import { describe, expect, it } from "vitest";
import { ChildWindowCommandQueue } from "./childWindowCommandQueue";
import { CHILD_WINDOW_COMMANDS } from "./childWindowProtocol";

describe("ChildWindowCommandQueue", () => {
  it("keeps commands in FIFO order until the matching listener is ready", () => {
    const queue = new ChildWindowCommandQueue();
    queue.register("file-editor-main", "token-new", CHILD_WINDOW_COMMANDS.remoteFileEditorOpen);

    expect(
      queue.dispatch("file-editor-main", CHILD_WINDOW_COMMANDS.remoteFileEditorOpen, { name: "a" }),
    ).toEqual([]);
    expect(
      queue.dispatch("file-editor-main", CHILD_WINDOW_COMMANDS.remoteFileEditorOpen, { name: "b" }),
    ).toEqual([]);

    expect(
      queue.markReady("file-editor-main", "token-new", CHILD_WINDOW_COMMANDS.remoteFileEditorOpen),
    ).toEqual([
      { event: CHILD_WINDOW_COMMANDS.remoteFileEditorOpen, payload: { name: "a" } },
      { event: CHILD_WINDOW_COMMANDS.remoteFileEditorOpen, payload: { name: "b" } },
    ]);
  });

  it("ignores a ready event from a stale WebView token", () => {
    const queue = new ChildWindowCommandQueue();
    queue.register("settings", "token-new", CHILD_WINDOW_COMMANDS.settingsOpenTab);
    queue.dispatch("settings", CHILD_WINDOW_COMMANDS.settingsOpenTab, { tab: "appearance" });

    expect(queue.markReady("settings", "token-old", CHILD_WINDOW_COMMANDS.settingsOpenTab)).toEqual(
      [],
    );
  });

  it("dispatches immediately after the listener is ready", () => {
    const queue = new ChildWindowCommandQueue();
    queue.register("settings", "token", CHILD_WINDOW_COMMANDS.settingsOpenTab);
    queue.markReady("settings", "token", CHILD_WINDOW_COMMANDS.settingsOpenTab);

    expect(
      queue.dispatch("settings", CHILD_WINDOW_COMMANDS.settingsOpenTab, { tab: "general" }),
    ).toEqual([{ event: CHILD_WINDOW_COMMANDS.settingsOpenTab, payload: { tab: "general" } }]);
  });

  it("queues new commands again while the child page reloads", () => {
    const queue = new ChildWindowCommandQueue();
    queue.register("settings", "token", CHILD_WINDOW_COMMANDS.settingsOpenTab);
    queue.markReady("settings", "token", CHILD_WINDOW_COMMANDS.settingsOpenTab);

    expect(queue.markLoading("settings", "token")).toBe(true);
    expect(
      queue.dispatch("settings", CHILD_WINDOW_COMMANDS.settingsOpenTab, { tab: "appearance" }),
    ).toEqual([]);
    expect(queue.markReady("settings", "token", CHILD_WINDOW_COMMANDS.settingsOpenTab)).toEqual([
      { event: CHILD_WINDOW_COMMANDS.settingsOpenTab, payload: { tab: "appearance" } },
    ]);
  });

  it("keeps direct dispatch compatibility for an untracked window", () => {
    const queue = new ChildWindowCommandQueue();

    expect(
      queue.dispatch("legacy-window", CHILD_WINDOW_COMMANDS.filePreviewOpen, { name: "a.png" }),
    ).toEqual([{ event: CHILD_WINDOW_COMMANDS.filePreviewOpen, payload: { name: "a.png" } }]);
  });

  it("clears state when a window is destroyed", () => {
    const queue = new ChildWindowCommandQueue();
    queue.register("settings", "token", CHILD_WINDOW_COMMANDS.settingsOpenTab);
    queue.dispatch("settings", CHILD_WINDOW_COMMANDS.settingsOpenTab, { tab: "appearance" });

    queue.clear("settings");

    expect(
      queue.dispatch("settings", CHILD_WINDOW_COMMANDS.settingsOpenTab, { tab: "general" }),
    ).toEqual([{ event: CHILD_WINDOW_COMMANDS.settingsOpenTab, payload: { tab: "general" } }]);
  });
});
