import type { Terminal } from "@xterm/xterm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installTerminalImageAddon, TERMINAL_IMAGE_ADDON_OPTIONS } from "./terminalImageAddon";

type MockImageAddon = {
  options: unknown;
  dispose: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  disposeShouldThrow: false,
  imageAddonInstances: [] as MockImageAddon[],
  warn: vi.fn(),
}));

vi.mock("@xterm/addon-image", () => ({
  ImageAddon: class {
    public options: unknown;
    public dispose = vi.fn(() => {
      if (mocks.disposeShouldThrow) {
        throw new Error("dispose failed");
      }
    });

    constructor(options?: unknown) {
      this.options = options;
      mocks.imageAddonInstances.push(this);
    }
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: mocks.warn,
  },
}));

function createTerminal(loadAddon = vi.fn()): Terminal {
  return { loadAddon } as unknown as Terminal;
}

describe("installTerminalImageAddon", () => {
  beforeEach(() => {
    mocks.disposeShouldThrow = false;
    mocks.imageAddonInstances.length = 0;
    mocks.warn.mockReset();
  });

  it("creates and loads one image addon with NyaTerm image limits", () => {
    const loadAddon = vi.fn();
    const terminal = createTerminal(loadAddon);

    const addon = installTerminalImageAddon(terminal, {
      sessionId: "session-1",
      sessionType: "SSH",
    });

    expect(addon).toBe(mocks.imageAddonInstances[0]);
    expect(mocks.imageAddonInstances[0]?.options).toEqual(TERMINAL_IMAGE_ADDON_OPTIONS);
    expect(loadAddon).toHaveBeenCalledTimes(1);
    expect(loadAddon).toHaveBeenCalledWith(mocks.imageAddonInstances[0]);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("does not register the image addon twice for the same terminal", () => {
    const loadAddon = vi.fn();
    const terminal = createTerminal(loadAddon);

    const firstAddon = installTerminalImageAddon(terminal);
    const secondAddon = installTerminalImageAddon(terminal);

    expect(secondAddon).toBe(firstAddon);
    expect(mocks.imageAddonInstances).toHaveLength(1);
    expect(loadAddon).toHaveBeenCalledTimes(1);
  });

  it("returns null and logs when image addon initialization fails", () => {
    const loadError = new Error("load failed");
    const terminal = createTerminal(
      vi.fn(() => {
        throw loadError;
      }),
    );

    const addon = installTerminalImageAddon(terminal, {
      sessionId: "session-2",
      sessionType: "Local",
    });

    expect(addon).toBeNull();
    expect(mocks.imageAddonInstances[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "terminal.input",
        event: "terminal.image_addon_failed",
        ids: { session_id: "session-2" },
        error: loadError,
      }),
    );
  });

  it("keeps terminal startup fail-soft if addon cleanup also fails", () => {
    mocks.disposeShouldThrow = true;
    const terminal = createTerminal(
      vi.fn(() => {
        throw new Error("load failed");
      }),
    );

    const addon = installTerminalImageAddon(terminal);

    expect(addon).toBeNull();
  });
});
