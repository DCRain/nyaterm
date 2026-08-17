import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedCredential } from "@/types/global";
import { useCredentialAutofill } from "./useCredentialAutofill";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

const credential: SavedCredential = {
  id: "cred-1",
  sort_order: 0,
  name: "Server Login",
  username: "alice",
  password_prompt_regex: "Password:\\s*$",
  username_prompt_regex: null,
  enabled: true,
  has_password: true,
};

function refs() {
  return {
    terminalRef: { current: null },
    sessionIdRef: { current: "session-1" },
    activeRef: { current: true },
    visibleRef: { current: true },
    performanceModeRef: { current: "normal" },
  };
}

describe("useCredentialAutofill prompt detection gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_saved_credentials") {
        return Promise.resolve([credential]);
      }
      return Promise.resolve(null);
    });
    mocks.listen.mockResolvedValue(vi.fn());
  });

  it("does not detect or retain prompts while the detection gate is closed", async () => {
    let canDetect = false;
    const hookRefs = refs();
    const { result, rerender } = renderHook(() =>
      useCredentialAutofill(
        hookRefs.terminalRef,
        hookRefs.sessionIdRef,
        hookRefs.activeRef,
        hookRefs.visibleRef,
        hookRefs.performanceModeRef,
        () => canDetect,
      ),
    );

    act(() => {
      result.current.feedOutput("Password:");
    });
    expect(result.current.panelState).toBeNull();

    canDetect = true;
    rerender();

    act(() => {
      result.current.feedOutput(" ");
    });

    await waitFor(() => expect(result.current.panelState).toBeNull());
  });

  it("detects a matching prompt when the detection gate is open", async () => {
    const hookRefs = refs();
    const { result } = renderHook(() =>
      useCredentialAutofill(
        hookRefs.terminalRef,
        hookRefs.sessionIdRef,
        hookRefs.activeRef,
        hookRefs.visibleRef,
        hookRefs.performanceModeRef,
        () => true,
      ),
    );

    act(() => {
      result.current.feedOutput("Password:");
    });

    await waitFor(() => {
      expect(result.current.panelState?.kind).toBe("password");
      expect(result.current.panelState?.matches).toEqual([credential]);
    });
  });
});
