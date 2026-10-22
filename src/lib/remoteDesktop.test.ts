import { describe, expect, it } from "vitest";
import { shouldLaunchExternalRemoteDesktop } from "./remoteDesktop";

describe("shouldLaunchExternalRemoteDesktop", () => {
  it("always launches VNC externally", () => {
    expect(shouldLaunchExternalRemoteDesktop({ type: "vnc" })).toBe(true);
  });

  it("ignores non-remote-desktop connections", () => {
    expect(shouldLaunchExternalRemoteDesktop({ type: "ssh" })).toBe(false);
    expect(shouldLaunchExternalRemoteDesktop(null)).toBe(false);
  });

  it.each([
    ["builtin", "external", false],
    ["windows", "external", false],
    ["builtin", "builtin", false],
    ["windows", "builtin", false],
    [undefined, "external", true],
    [undefined, "builtin", false],
    [undefined, undefined, true],
  ] as const)(
    "rdp_client_mode=%s client_mode=%s → shouldLaunchExternal=%s",
    (rdpClientMode, clientMode, expected) => {
      expect(
        shouldLaunchExternalRemoteDesktop({
          type: "rdp",
          rdp_client_mode: rdpClientMode,
          client_mode: clientMode,
        }),
      ).toBe(expected);
    },
  );
});
