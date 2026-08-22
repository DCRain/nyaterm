import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import { REMOTE_COLOR_OSC_IDS, installRemoteColorOscGuard } from "./remoteColorOscGuard";

function terminalWithParser() {
  const disposables = new Map<number, ReturnType<typeof vi.fn>>();
  const terminal = {
    parser: {
      registerOscHandler: vi.fn((oscId: number, handler: (data: string) => boolean) => {
        disposables.set(oscId, vi.fn());
        return {
          dispose: disposables.get(oscId) as () => void,
          handler,
        };
      }),
    },
  };

  return { terminal: terminal as unknown as Terminal, registerOscHandler: terminal.parser.registerOscHandler };
}

describe("installRemoteColorOscGuard", () => {
  it("does not block remote color OSC by default for ordinary sessions", () => {
    const { terminal, registerOscHandler } = terminalWithParser();

    installRemoteColorOscGuard(terminal, "SSH");

    expect(registerOscHandler).not.toHaveBeenCalled();
  });

  it("blocks only default background OSC for transparent ordinary sessions", () => {
    const { terminal, registerOscHandler } = terminalWithParser();
    const onBlocked = vi.fn();

    installRemoteColorOscGuard(terminal, "SSH", onBlocked, { blockDefaultBackground: true });

    expect(registerOscHandler).toHaveBeenCalledOnce();
    expect(registerOscHandler).toHaveBeenCalledWith(11, expect.any(Function));

    const handler = registerOscHandler.mock.calls[0]?.[1];
    expect(handler?.("#000000")).toBe(true);
    expect(onBlocked).toHaveBeenCalledWith(11, "#000000");
  });

  it("keeps the serial session broad color OSC guard", () => {
    const { terminal, registerOscHandler } = terminalWithParser();

    installRemoteColorOscGuard(terminal, "Serial");

    expect(registerOscHandler).toHaveBeenCalledTimes(REMOTE_COLOR_OSC_IDS.length);
    expect(registerOscHandler.mock.calls.map(([oscId]) => oscId)).toEqual(REMOTE_COLOR_OSC_IDS);
  });

  it("does not duplicate OSC 11 when serial sessions also request transparency protection", () => {
    const { terminal, registerOscHandler } = terminalWithParser();

    installRemoteColorOscGuard(terminal, "Serial", undefined, { blockDefaultBackground: true });

    expect(registerOscHandler.mock.calls.filter(([oscId]) => oscId === 11)).toHaveLength(1);
  });
});
