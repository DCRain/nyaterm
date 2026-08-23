import { describe, expect, it } from "vitest";
import type { SavedConnection } from "@/types/global";
import {
  type ExternalOpenIntent,
  type ExternalNetworkOpenIntent,
  findExternalConnectionMatches,
  parseExternalOpenUrl,
} from "./externalOpen";

describe("parseExternalOpenUrl", () => {
  it("parses SSH deep link URLs and uses the default port", () => {
    const result = parseExternalOpenUrl("ssh://root@example.com");
    expect(result.ok).toBe(true);
    expect(networkIntent(result).port).toBe(22);
    expect(sshRuntimeMode(networkIntent(result))).toBe("standard");
  });

  it("preserves SSH terminal runtime mode through normalization", () => {
    const result = parseExternalOpenUrl("ssh://root@example.com?mode=terminal");
    expect(result.ok).toBe(true);
    expect(sshRuntimeMode(networkIntent(result))).toBe("terminal");
    expect(networkIntent(result).runtimeModeSpecified).toBe(true);
  });

  it("rejects invalid SSH runtime mode values", () => {
    const result = parseExternalOpenUrl("ssh://root@example.com?mode=foo");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorKey).toBe("externalOpen.invalidMode");
  });

  it("parses Telnet deep link URLs and uses the default port", () => {
    const result = parseExternalOpenUrl("telnet://example.com");
    expect(result.ok).toBe(true);
    expect(networkIntent(result).port).toBe(23);
  });

  it("normalizes IPv6 hosts", () => {
    const result = parseExternalOpenUrl("ssh://root@[2001:db8::1]:2222");
    expect(result.ok).toBe(true);
    expect(networkIntent(result).host).toBe("2001:db8::1");
    expect(networkIntent(result).port).toBe(2222);
  });

  it("decodes URL-encoded SSH usernames", () => {
    const result = parseExternalOpenUrl("ssh://user%2Bprod@example.com:22");
    expect(result.ok).toBe(true);
    expect(networkIntent(result).username).toBe("user+prod");
    expect(networkIntent(result).usernameSpecified).toBe(true);
  });

  it("parses one-time SSH URL passwords", () => {
    const result = parseExternalOpenUrl("ssh://root:secret@example.com:22");
    expect(result.ok).toBe(true);
    expect(sshPassword(networkIntent(result))).toBe("secret");
    expect(networkIntent(result).passwordSpecified).toBe(true);
  });

  it("decodes URL-encoded SSH URL passwords", () => {
    const result = parseExternalOpenUrl(
      "ssh://user:p%40ss%3Aword@example.com:22",
    );
    expect(result.ok).toBe(true);
    expect(sshPassword(networkIntent(result))).toBe("p@ss:word");
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
    expect(networkIntent(result)).toMatchObject({
      protocol: "ssh",
      host: "192.168.1.10",
      port: 2222,
      username: "root",
      usernameSpecified: true,
    });
    expect(sshRuntimeMode(networkIntent(result))).toBe("standard");
  });

  it("parses NyaTerm SSH terminal runtime mode", () => {
    const result = parseExternalOpenUrl(
      "nyaterm://connect/ssh?host=example.com&username=root&mode=terminal",
    );
    expect(result.ok).toBe(true);
    expect(sshRuntimeMode(networkIntent(result))).toBe("terminal");
    expect(networkIntent(result).runtimeModeSpecified).toBe(true);
  });

  it("uses decoded NyaTerm query usernames once", () => {
    const result = parseExternalOpenUrl(
      "nyaterm://connect/ssh?host=example.com&username=user%25prod",
    );
    expect(result.ok).toBe(true);
    expect(networkIntent(result).username).toBe("user%prod");
  });

  it("parses NyaTerm Telnet deep links", () => {
    const result = parseExternalOpenUrl(
      "nyaterm://connect/telnet?host=192.168.1.10&port=2323",
    );
    expect(result.ok).toBe(true);
    expect(networkIntent(result)).toMatchObject({
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

  it("parses NyaTerm local terminal deep links", () => {
    const result = parseExternalOpenUrl("nyaterm://connect/local");
    expect(result.ok).toBe(true);
    expect(intent(result)).toEqual({
      protocol: "local",
      workingDir: null,
    });
  });

  it("parses NyaTerm local terminal cwd paths", () => {
    const cases = [
      ["nyaterm://connect/local?cwd=%2Fhome%2Fuser%2Fproject", "/home/user/project"],
      ["nyaterm://connect/local?cwd=%2FUsers%2Fnya%2Fproject", "/Users/nya/project"],
      [
        "nyaterm://connect/local?cwd=D%3A%5CProjects%5Cfoo",
        "D:\\Projects\\foo",
      ],
      [
        "nyaterm://connect/local?cwd=D%3A%5CProjects%5Chello%20world",
        "D:\\Projects\\hello world",
      ],
      ["nyaterm://connect/local?cwd=D%3A%5C%E9%A1%B9%E7%9B%AE", "D:\\项目"],
      ["nyaterm://connect/local?cwd=%2Ftmp%2Fhash%23dir", "/tmp/hash#dir"],
      ["nyaterm://connect/local?cwd=%2Ftmp%2Fa%26b", "/tmp/a&b"],
    ];

    for (const [url, workingDir] of cases) {
      const result = parseExternalOpenUrl(url);
      expect(result.ok).toBe(true);
      expect(intent(result)).toEqual({
        protocol: "local",
        workingDir,
      });
    }
  });

  it("rejects NyaTerm local terminal network and command parameters", () => {
    for (const url of [
      "nyaterm://connect/local?host=example.com",
      "nyaterm://connect/local?command=rm%20-rf%20%2F",
      "nyaterm://connect/local?mode=terminal",
    ]) {
      const result = parseExternalOpenUrl(url);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.errorKey).toBe("externalOpen.unsupportedParameter");
    }
  });

  it("rejects NyaTerm local terminal passwords", () => {
    const result = parseExternalOpenUrl("nyaterm://connect/local?password=x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorKey).toBe("externalOpen.inlinePassword");
  });

  it("rejects empty NyaTerm local terminal cwd values", () => {
    const result = parseExternalOpenUrl("nyaterm://connect/local?cwd=");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorKey).toBe("externalOpen.invalidUrl");
  });
});

describe("findExternalConnectionMatches", () => {
  it("returns a unique saved SSH match", () => {
    const result = findExternalConnectionMatches(
      [sshConnection({ username: "root" })],
      networkIntent(parseExternalOpenUrl("ssh://root@example.com:22")),
    );
    expect(result.kind).toBe("saved");
  });

  it("preserves an explicit terminal mode override for saved SSH matches", () => {
    const result = findExternalConnectionMatches(
      [sshConnection({ username: "root" })],
      networkIntent(
        parseExternalOpenUrl("ssh://root@example.com:22?mode=terminal"),
      ),
    );

    expect(result.kind).toBe("saved");
    if (result.kind === "saved") {
      expect(result.runtimeModeOverride).toBe("terminal");
    }
  });

  it("returns a temporary config when no saved connection matches", () => {
    const result = findExternalConnectionMatches(
      [sshConnection({ host: "other.example.com" })],
      networkIntent(parseExternalOpenUrl("ssh://root@example.com:22")),
    );
    expect(result.kind).toBe("temporary");
  });

  it("returns a temporary config when an SSH URL includes a one-time password", () => {
    const result = findExternalConnectionMatches(
      [sshConnection({ username: "root" })],
      networkIntent(parseExternalOpenUrl("ssh://root:secret@example.com:22")),
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
      networkIntent(parseExternalOpenUrl("ssh://root@example.com:22")),
    );
    expect(result.kind).toBe("ambiguous");
  });

  it("matches SSH by host and port when username is omitted", () => {
    const result = findExternalConnectionMatches(
      [sshConnection({ username: "admin" })],
      networkIntent(parseExternalOpenUrl("ssh://example.com:22")),
    );
    expect(result.kind).toBe("saved");
  });

  it("matches SSH by exact username when username is specified", () => {
    const result = findExternalConnectionMatches(
      [
        sshConnection({ id: "admin", username: "admin" }),
        sshConnection({ id: "root", username: "root" }),
      ],
      networkIntent(parseExternalOpenUrl("ssh://root@example.com:22")),
    );
    expect(result.kind).toBe("saved");
    if (result.kind === "saved") expect(result.connection.id).toBe("root");
  });

  it("matches Telnet by host and port", () => {
    const result = findExternalConnectionMatches(
      [telnetConnection()],
      networkIntent(parseExternalOpenUrl("telnet://example.com:23")),
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

function networkIntent(
  result: ReturnType<typeof parseExternalOpenUrl>,
): ExternalNetworkOpenIntent {
  const value = intent(result);
  if (value.protocol === "local") throw new Error("Expected network intent");
  return value;
}

function sshPassword(intent: ExternalOpenIntent) {
  if (intent.protocol !== "ssh") return null;
  if (intent.temporary.protocol !== "ssh") return null;
  return sshPasswordFromConfig(intent.temporary);
}

function sshRuntimeMode(intent: ExternalOpenIntent) {
  return intent.protocol === "ssh" && intent.temporary.protocol === "ssh"
    ? intent.temporary.runtime_mode
    : null;
}

function sshPasswordFromConfig(
  config: Extract<ExternalNetworkOpenIntent["temporary"], { protocol: "ssh" }>,
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
