import { describe, expect, it } from "vitest";
import type { SessionPane } from "@/types/global";
import { canCreateSessionFromPane } from "./appWorkspace";

const basePane = {
  id: "pane-1",
  kind: "leaf",
  paneKind: "terminal",
  sessionId: "session-1",
  name: "Session",
  connecting: false,
} as const;

function pane(overrides: Partial<SessionPane>): SessionPane {
  return {
    ...basePane,
    type: "SSH",
    ...overrides,
  } as SessionPane;
}

describe("canCreateSessionFromPane", () => {
  it("allows temporary panes with matching protocols", () => {
    expect(
      canCreateSessionFromPane(
        pane({
          type: "SSH",
          temporaryConfig: {
            protocol: "ssh",
            name: "root@example.com:22",
            host: "example.com",
            port: 22,
            username: "root",
            auth: { type: "password", password: "secret" },
            backspace_mode: "del",
            x11_forwarding: false,
            x11_display: "",
            proxy: null,
            proxy_jump: null,
            post_login: null,
          },
        }),
      ),
    ).toBe(true);

    expect(
      canCreateSessionFromPane(
        pane({
          type: "Telnet",
          temporaryConfig: {
            protocol: "telnet",
            name: "telnet://example.com:23",
            host: "example.com",
            port: 23,
          },
        }),
      ),
    ).toBe(true);

    expect(
      canCreateSessionFromPane(
        pane({
          type: "Serial",
          temporaryConfig: {
            protocol: "serial",
            name: "COM3 @ 115200",
            portName: "COM3",
            baudRate: 115200,
          },
        }),
      ),
    ).toBe(true);
  });

  it("rejects panes without a saved connection or matching temporary config", () => {
    expect(canCreateSessionFromPane(pane({ type: "SSH" }))).toBe(false);
    expect(
      canCreateSessionFromPane(
        pane({
          type: "SSH",
          temporaryConfig: {
            protocol: "telnet",
            name: "telnet://example.com:23",
            host: "example.com",
            port: 23,
          },
        }),
      ),
    ).toBe(false);
  });

  it("still allows local panes without connection metadata", () => {
    expect(canCreateSessionFromPane(pane({ type: "Local" }))).toBe(true);
  });
});
