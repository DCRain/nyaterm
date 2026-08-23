import { describe, expect, it } from "vitest";
import type { SavedConnection } from "@/types/global";
import {
  type ExternalOpenIntent,
  findExternalConnectionMatches,
  parseExternalOpenUrl,
} from "./externalOpen";

describe("parseExternalOpenUrl", () => {
  it("parses SSH deep link URLs and uses the default port", () => {
    const result = parseExternalOpenUrl("ssh://root@example.com");
    expect(result.ok).toBe(true);
    expect(intent(result).port).toBe(22);
    expect(sshRuntimeMode(intent(result))).toBe("standard");
  });

  it("preserves SSH terminal runtime mode through normalization", () => {
    const result = parseExternalOpenUrl("ssh://root@example.com?mode=terminal");
    expect(result.ok).toBe(true);
    expect(sshRuntimeMode(intent(result))).toBe("terminal");
    expect(intent(result).runtimeModeSpecified).toBe(true);
  });

  it("rejects invalid SSH runtime mode values", () => {
    const result = parseExternalOpenUrl("ssh://root@example.com?mode=foo");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorKey).toBe("externalOpen.invalidMode");
  });

  it("parses Telnet deep link URLs and uses the default port", () => {
    const result = parseExternalOpenUrl("telnet://example.com");
    expect(result.ok).toBe(true);
    expect(intent(result).port).toBe(23);
  });

  it("normalizes IPv6 hosts", () => {
    const result = parseExternalOpenUrl("ssh://root@[2001:db8::1]:2222");
    expect(result.ok).toBe(true);
    expect(intent(result).host).toBe("2001:db8::1");
    expect(intent(result).port).toBe(2222);
  });

  it("decodes URL-encoded SSH usernames", () => {
    const result = parseExternalOpenUrl("ssh://user%2Bprod@example.com:22");
    expect(result.ok).toBe(true);
    expect(intent(result).username).toBe("user+prod");
    expect(intent(result).usernameSpecified).toBe(true);
  });

  it("parses one-time SSH URL passwords", () => {
    const result = parseExternalOpenUrl("ssh://root:secret@example.com:22");
    expect(result.ok).toBe(true);
    expect(sshPassword(intent(result))).toBe("secret");
    expect(intent(result).passwordSpecified).toBe(true);
  });

  it("decodes URL-encoded SSH URL passwords", () => {
    const result = parseExternalOpenUrl(
      "ssh://user:p%40ss%3Aword@example.com:22",
    );
    expect(result.ok).toBe(true);
    expect(sshPassword(intent(result))).toBe("p@ss:word");
  });

  it("rejects NyaTerm deep link passwords", () => {
    const result = parseExternalOpenUrl(
      "nyaterm://connect/ssh?host=example.com&username=root&password=secret",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorKey).toBe("externalOpen.inlinePassword");
  });

  it("rejects non-URL password forms", () => {
    expect(parseExternalOpenUrl("root:secret@example.com").ok).toBe(false);
    expect(parseExternalOpenUrl("ssh root:secret@example.com").ok).toBe(false);
  });

  it("rejects invalid ports", () => {
    const result = parseExternalOpenUrl("ssh://root@example.com:70000");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorKey).toBe("externalOpen.invalidPort");
  });

  it("parses NyaTerm SSH deep links", () => {
    const result = parseExternalOpenUrl(
      "nyaterm://connect/ssh?host=192.168.1.10&port=2222&username=root",
    );
    expect(result.ok).toBe(true);
    expect(intent(result)).toMatchObject({
      protocol: "ssh",
      host: "192.168.1.10",
      port: 2222,
      username: "root",
      usernameSpecified: true,
    });
    expect(sshRuntimeMode(intent(result))).toBe("standard");
  });

  it("parses NyaTerm SSH terminal runtime mode", () => {
    const result = parseExternalOpenUrl(
      "nyaterm://connect/ssh?host=example.com&username=root&mode=terminal",
    );
    expect(result.ok).toBe(true);
    expect(sshRuntimeMode(intent(result))).toBe("terminal");
    expect(intent(result).runtimeModeSpecified).toBe(true);
  });

  it("uses decoded NyaTerm query usernames once", () => {
    const result = parseExternalOpenUrl(
      "nyaterm://connect/ssh?host=example.com&username=user%25prod",
    );
    expect(result.ok).toBe(true);
    expect(intent(result).username).toBe("user%prod");
  });

  it("parses NyaTerm Telnet deep links", () => {
    const result = parseExternalOpenUrl(
      "nyaterm://connect/telnet?host=192.168.1.10&port=2323",
    );
    expect(result.ok).toBe(true);
    expect(intent(result)).toMatchObject({
      protocol: "telnet",
      host: "192.168.1.10",
      port: 2323,
    });
  });

  it("rejects NyaTerm Telnet runtime mode", () => {
    const result = parseExternalOpenUrl(
      "nyaterm://connect/telnet?host=example.com&mode=terminal",
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errorKey).toBe("externalOpen.unsupportedParameter");
  });
});

describe("findExternalConnectionMatches", () => {
  it("returns a unique saved SSH match", () => {
    const result = findExternalConnectionMatches(
      [sshConnection({ username: "root" })],
      intent(parseExternalOpenUrl("ssh://root@example.com:22")),
    );
    expect(result.kind).toBe("saved");
  });

  it("preserves an explicit terminal mode override for saved SSH matches", () => {
    const result = findExternalConnectionMatches(
      [sshConnection({ username: "root" })],
      intent(parseExternalOpenUrl("ssh://root@example.com:22?mode=terminal")),
    );

    expect(result.kind).toBe("saved");
    if (result.kind === "saved") {
      expect(result.runtimeModeOverride).toBe("terminal");
    }
  });

  it("returns a temporary config when no saved connection matches", () => {
    const result = findExternalConnectionMatches(
      [sshConnection({ host: "other.example.com" })],
      intent(parseExternalOpenUrl("ssh://root@example.com:22")),
    );
    expect(result.kind).toBe("temporary");
  });

  it("returns a temporary config when an SSH URL includes a one-time password", () => {
    const result = findExternalConnectionMatches(
      [sshConnection({ username: "root" })],
      intent(parseExternalOpenUrl("ssh://root:secret@example.com:22")),
    );
    expect(result.kind).toBe("temporary");
    if (result.kind === "temporary" && result.config.protocol === "ssh") {
      expect(sshPasswordFromConfig(result.config)).toBe("secret");
    }
  });

  it("returns ambiguous when multiple saved connections match", () => {
    const result = findExternalConnectionMatches(
      [
        sshConnection({ id: "a", username: "root" }),
        sshConnection({ id: "b", username: "root" }),
      ],
      intent(parseExternalOpenUrl("ssh://root@example.com:22")),
    );
    expect(result.kind).toBe("ambiguous");
  });

  it("matches SSH by host and port when username is omitted", () => {
    const result = findExternalConnectionMatches(
      [sshConnection({ username: "admin" })],
      intent(parseExternalOpenUrl("ssh://example.com:22")),
    );
    expect(result.kind).toBe("saved");
  });

  it("matches SSH by exact username when username is specified", () => {
    const result = findExternalConnectionMatches(
      [
        sshConnection({ id: "admin", username: "admin" }),
        sshConnection({ id: "root", username: "root" }),
      ],
      intent(parseExternalOpenUrl("ssh://root@example.com:22")),
    );
    expect(result.kind).toBe("saved");
    if (result.kind === "saved") expect(result.connection.id).toBe("root");
  });

  it("matches Telnet by host and port", () => {
    const result = findExternalConnectionMatches(
      [telnetConnection()],
      intent(parseExternalOpenUrl("telnet://example.com:23")),
    );
    expect(result.kind).toBe("saved");
  });
});

function intent(
  result: ReturnType<typeof parseExternalOpenUrl>,
): ExternalOpenIntent {
  if (!result.ok) throw new Error(result.errorKey);
  return result.intent;
}

function sshPassword(intent: ExternalOpenIntent) {
  if (intent.temporary.protocol !== "ssh") return null;
  return sshPasswordFromConfig(intent.temporary);
}

function sshRuntimeMode(intent: ExternalOpenIntent) {
  return intent.temporary.protocol === "ssh"
    ? intent.temporary.runtime_mode
    : null;
}

function sshPasswordFromConfig(
  config: Extract<ExternalOpenIntent["temporary"], { protocol: "ssh" }>,
) {
  return config.auth.type === "password" ? config.auth.password : null;
}

function sshConnection(
  overrides: Partial<SavedConnection> = {},
): SavedConnection {
  return {
    id: overrides.id ?? "ssh",
    name: overrides.name ?? "SSH",
    type: "ssh",
    host: overrides.host ?? "example.com",
    port: overrides.port ?? 22,
    username: overrides.username ?? "root",
    ...overrides,
  };
}

function telnetConnection(
  overrides: Partial<SavedConnection> = {},
): SavedConnection {
  return {
    id: overrides.id ?? "telnet",
    name: overrides.name ?? "Telnet",
    type: "telnet",
    host: overrides.host ?? "example.com",
    port: overrides.port ?? 23,
    ...overrides,
  };
}
