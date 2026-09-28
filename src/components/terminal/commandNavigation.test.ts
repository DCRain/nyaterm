import type { IMarker } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import {
  CommandNavigation,
  shouldRecordFallbackCommand,
  startsObviousInteractiveSession,
} from "./commandNavigation";

function marker(line: number) {
  const callbacks: (() => void)[] = [];
  const value = {
    line,
    isDisposed: false,
    onDispose: vi.fn((callback: () => void) => {
      callbacks.push(callback);
      return { dispose: vi.fn() };
    }),
    dispose: vi.fn(() => {
      if (value.isDisposed) return;
      value.isDisposed = true;
      callbacks.forEach((callback) => {
        callback();
      });
    }),
  };
  return value as unknown as IMarker & {
    line: number;
    dispose: ReturnType<typeof vi.fn>;
  };
}

describe("CommandNavigation", () => {
  it("navigates previous and next across boundaries and the current prompt", () => {
    const navigation = new CommandNavigation();
    navigation.add(marker(0));
    navigation.add(marker(5));
    navigation.add(marker(10));
    expect(navigation.navigate(-1, 15)).toBe(10);
    expect(navigation.navigate(-1, 15)).toBe(5);
    expect(navigation.navigate(-1, 15)).toBe(0);
    expect(navigation.navigate(-1, 15)).toBeNull();
    expect(navigation.navigate(1, 15)).toBe(5);
    expect(navigation.navigate(1, 15)).toBe(10);
    expect(navigation.navigate(1, 15)).toBe(15);
    expect(navigation.navigate(1, 15)).toBeNull();
  });

  it("removes disposed markers and follows their current lines after resize", () => {
    const navigation = new CommandNavigation();
    const first = marker(2);
    const second = marker(8);
    navigation.add(first);
    navigation.add(second);
    first.dispose();
    expect(navigation.size).toBe(1);
    expect(navigation.navigate(-1, 12)).toBe(8);
    second.line = 6;
    navigation.resetPosition();
    expect(navigation.navigate(-1, 12)).toBe(6);
  });

  it("selects a command block, extends it, and resets after selection clears", () => {
    const navigation = new CommandNavigation();
    navigation.add(marker(1));
    navigation.add(marker(5));
    navigation.add(marker(9));
    expect(navigation.select(12)).toEqual({ start: 9, end: 12 });
    navigation.resetSelection();
    expect(navigation.navigate(-1, 12)).toBe(9);
    expect(navigation.navigate(-1, 12)).toBe(5);
    expect(navigation.select(12)).toEqual({ start: 5, end: 8 });
    expect(navigation.select(12)).toEqual({ start: 5, end: 12 });
    expect(navigation.select(12)).toBeNull();
    navigation.resetSelection();
    expect(navigation.select(12)).toEqual({ start: 5, end: 8 });
  });

  it("commits OSC prompt markers only at command start and clears each marker once", () => {
    const navigation = new CommandNavigation();
    const emptyPrompt = marker(0);
    const submitted = marker(2);
    navigation.promptStart(emptyPrompt);
    navigation.promptStart(submitted);
    expect(emptyPrompt.dispose).toHaveBeenCalledOnce();
    expect(navigation.size).toBe(0);
    navigation.commandStart();
    navigation.add(marker(2));
    expect(navigation.size).toBe(1);
    navigation.clear();
    expect(navigation.size).toBe(0);
    expect(submitted.dispose).toHaveBeenCalledOnce();
    navigation.clear();
    expect(submitted.dispose).toHaveBeenCalledOnce();
  });
});

describe("fallback command detection", () => {
  const valid = {
    command: "dir",
    sessionType: "Local" as const,
    shellIntegrationEnabled: false,
    bufferType: "normal",
    disconnected: false,
    aiCapturing: false,
    credentialPrompt: false,
    interactive: false,
  };

  it("accepts a tracked local shell submission without OSC 133", () => {
    expect(shouldRecordFallbackCommand(valid)).toBe(true);
  });

  it("rejects OSC, alternate screen, disconnected and interactive input", () => {
    for (const change of [
      { shellIntegrationEnabled: true },
      { bufferType: "alternate" },
      { disconnected: true },
      { aiCapturing: true },
      { credentialPrompt: true },
      { interactive: true },
      { command: "" },
      { sessionType: "SSH" as const },
    ]) {
      expect(shouldRecordFallbackCommand({ ...valid, ...change })).toBe(false);
    }
  });

  it("identifies obvious REPL and nested-shell launches", () => {
    for (const command of [
      "python",
      "python3",
      "node",
      "pwsh",
      "cmd /k",
      "bash",
    ]) {
      expect(startsObviousInteractiveSession(command)).toBe(true);
    }
    expect(startsObviousInteractiveSession("python script.py")).toBe(false);
    expect(startsObviousInteractiveSession("dir")).toBe(false);
  });
});
