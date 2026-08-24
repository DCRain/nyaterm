import type { SavedConnection } from "@/types/global";
import {
  parseSshRuntimeMode,
  parseTemporaryLink,
  type SshRuntimeMode,
  type TemporaryLinkConfig,
  type TemporarySshLinkConfig,
  type TemporaryTelnetLinkConfig,
} from "./temporaryLink";

export type ExternalNetworkOpenProtocol = "ssh" | "telnet";
export type ExternalOpenProtocol = ExternalNetworkOpenProtocol | "local";

export interface ExternalNetworkOpenIntent {
  protocol: ExternalNetworkOpenProtocol;
  host: string;
  port: number;
  username: string | null;
  usernameSpecified: boolean;
  passwordSpecified: boolean;
  runtimeMode?: SshRuntimeMode;
  runtimeModeSpecified: boolean;
  temporary: TemporaryLinkConfig;
}

export interface ExternalLocalOpenIntent {
  protocol: "local";
  workingDir: string | null;
}

export type ExternalOpenIntent =
  | ExternalNetworkOpenIntent
  | ExternalLocalOpenIntent;

export type ExternalOpenParseResult =
  | { ok: true; intent: ExternalOpenIntent }
  | { ok: false; errorKey: string; errorType: string; scheme?: string };

export type ExternalConnectionResolution =
  | {
      kind: "saved";
      connection: SavedConnection;
      runtimeModeOverride?: SshRuntimeMode;
    }
  | {
      kind: "ambiguous";
      connections: SavedConnection[];
      temporary: TemporaryLinkConfig;
      runtimeModeOverride?: SshRuntimeMode;
    }
  | { kind: "temporary"; config: TemporaryLinkConfig }
  | { kind: "invalid"; errorKey: string; errorType: string };

const DEFAULT_SSH_PORT = 22;
const DEFAULT_TELNET_PORT = 23;
const DEFAULT_USERNAME = "root";
const UNSUPPORTED_NYATERM_PARAMS = new Set([
  "command",
  "postlogin",
  "post_login",
  "identityfile",
  "identity_file",
  "proxy",
  "proxyjump",
  "proxy_jump",
  "localforward",
  "local_forward",
  "remoteforward",
  "remote_forward",
  "dynamicforward",
  "dynamic_forward",
  "l",
  "r",
  "d",
]);

export function parseExternalOpenUrl(rawUrl: string): ExternalOpenParseResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) return invalid("externalOpen.invalidUrl", "empty");

  const scheme = schemeOf(trimmed);
  if (!scheme) return invalid("externalOpen.invalidUrl", "invalid_url");

  if (scheme === "ssh" || scheme === "telnet") {
    return parseExternalTemporaryUrl(trimmed, scheme);
  }

  if (scheme === "nyaterm") {
    return parseNyatermUrl(trimmed);
  }

  return invalid(
    "externalOpen.unsupportedProtocol",
    "unsupported_scheme",
    scheme,
  );
}

export function findExternalConnectionMatches(
  savedConnections: SavedConnection[],
  intent: ExternalNetworkOpenIntent,
): ExternalConnectionResolution {
  if (intent.protocol === "ssh" && intent.passwordSpecified) {
    return { kind: "temporary", config: intent.temporary };
  }

  const matches = savedConnections.filter((connection) => {
    if (connection.type !== intent.protocol) return false;
    if (normalizeHostForMatch(connection.host ?? "") !== intent.host)
      return false;
    if (
      normalizePortForProtocol(connection.port, intent.protocol) !== intent.port
    )
      return false;
    if (intent.protocol === "ssh" && intent.usernameSpecified) {
      return (connection.username ?? "") === intent.username;
    }
    return true;
  });

  const runtimeModeOverride =
    intent.protocol === "ssh" && intent.runtimeModeSpecified
      ? intent.runtimeMode
      : undefined;

  if (matches.length === 1) {
    return { kind: "saved", connection: matches[0], runtimeModeOverride };
  }
  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      connections: matches,
      temporary: intent.temporary,
      runtimeModeOverride,
    };
  }
  return { kind: "temporary", config: intent.temporary };
}

function parseExternalTemporaryUrl(
  rawUrl: string,
  protocol: ExternalNetworkOpenProtocol,
): ExternalOpenParseResult {
  const parsed = parseTemporaryLink(protocol, rawUrl);
  if (!parsed.ok) {
    if (hasInvalidExplicitUrlPort(rawUrl)) {
      return invalid("externalOpen.invalidPort", "invalid_port", protocol);
    }
    return invalid(
      mapTemporaryErrorKey(parsed.errorKey),
      temporaryErrorType(parsed.errorKey),
      protocol,
    );
  }
  if (parsed.config.protocol !== protocol) {
    return invalid("externalOpen.invalidUrl", "invalid_protocol", protocol);
  }

  const url = new URL(rawUrl);
  const host = normalizeHostForMatch(parsed.config.host);
  const port = normalizePortForProtocol(parsed.config.port, protocol);

  if (protocol === "ssh") {
    const sshConfig = parsed.config as TemporarySshLinkConfig;
    const usernameSpecified = url.username.length > 0;
    const passwordSpecified = temporarySshPasswordSpecified(sshConfig);
    const runtimeModeSpecified = url.searchParams.has("mode");
    return {
      ok: true,
      intent: {
        protocol,
        host,
        port,
        username: usernameSpecified ? sshConfig.username : null,
        usernameSpecified,
        passwordSpecified,
        runtimeMode: sshConfig.runtime_mode,
        runtimeModeSpecified,
        temporary: normalizeTemporaryConfig(sshConfig, host, port),
      },
    };
  }

  return {
    ok: true,
    intent: {
      protocol,
      host,
      port,
      username: null,
      usernameSpecified: false,
      passwordSpecified: false,
      runtimeModeSpecified: false,
      temporary: normalizeTemporaryConfig(parsed.config, host, port),
    },
  };
}

function parseNyatermUrl(rawUrl: string): ExternalOpenParseResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return invalid("externalOpen.invalidUrl", "invalid_url", "nyaterm");
  }

  if (url.hostname.toLowerCase() !== "connect") {
    return invalid("externalOpen.invalidUrl", "invalid_path", "nyaterm");
  }

  const protocol = url.pathname.replace(/^\/+/, "").toLowerCase();
  if (protocol !== "ssh" && protocol !== "telnet" && protocol !== "local") {
    return invalid(
      "externalOpen.unsupportedProtocol",
      "unsupported_scheme",
      "nyaterm",
    );
  }

  const params = url.searchParams;
  if (protocol === "local") {
    return parseNyatermLocalUrl(params);
  }

  for (const key of params.keys()) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "password") {
      return invalid(
        "externalOpen.inlinePassword",
        "inline_password",
        "nyaterm",
      );
    }
    if (protocol !== "ssh" && normalizedKey === "mode") {
      return invalid(
        "externalOpen.unsupportedParameter",
        "unsupported_parameter",
        "nyaterm",
      );
    }
    if (UNSUPPORTED_NYATERM_PARAMS.has(normalizedKey)) {
      return invalid(
        "externalOpen.unsupportedParameter",
        "unsupported_parameter",
        "nyaterm",
      );
    }
  }

  const host = normalizeHostForMatch(params.get("host") ?? "");
  if (!host)
    return invalid("externalOpen.missingHost", "missing_host", "nyaterm");

  const port = parsePort(params.get("port"), protocol);
  if (port === null)
    return invalid("externalOpen.invalidPort", "invalid_port", "nyaterm");

  if (protocol === "ssh") {
    const username = (params.get("username") ?? DEFAULT_USERNAME).trim();
    if (!username)
      return invalid("externalOpen.invalidUrl", "missing_username", "nyaterm");
    const runtimeMode = parseSshRuntimeMode(params.get("mode"));
    if (!runtimeMode)
      return invalid("externalOpen.invalidMode", "invalid_mode", "nyaterm");
    return {
      ok: true,
      intent: {
        protocol,
        host,
        port,
        username,
        usernameSpecified: params.has("username"),
        passwordSpecified: false,
        runtimeMode,
        runtimeModeSpecified: params.has("mode"),
        temporary: createTemporarySshConfig(
          host,
          port,
          username,
          null,
          runtimeMode,
        ),
      },
    };
  }

  if (params.has("username")) {
    return invalid(
      "externalOpen.invalidUrl",
      "unsupported_username",
      "nyaterm",
    );
  }

  return {
    ok: true,
    intent: {
      protocol,
      host,
      port,
      username: null,
      usernameSpecified: false,
      passwordSpecified: false,
      runtimeModeSpecified: false,
      temporary: createTemporaryTelnetConfig(host, port),
    },
  };
}

function normalizeTemporaryConfig(
  config: TemporaryLinkConfig,
  host: string,
  port: number,
): TemporaryLinkConfig {
  if (config.protocol === "ssh") {
    return createTemporarySshConfig(
      host,
      port,
      config.username,
      temporarySshPassword(config),
      config.runtime_mode,
    );
  }
  if (config.protocol === "telnet") {
    return createTemporaryTelnetConfig(host, port);
  }
  return config;
}

function createTemporarySshConfig(
  host: string,
  port: number,
  username: string,
  password: string | null = null,
  runtimeMode: SshRuntimeMode = "standard",
): TemporarySshLinkConfig {
  return {
    protocol: "ssh",
    runtime_mode: runtimeMode,
    name: `${username}@${host}:${port}`,
    host,
    port,
    username,
    auth: { type: "password", password },
    backspace_mode: "del",
    x11_forwarding: false,
    x11_display: "",
    proxy: null,
    proxy_jump: null,
    post_login: null,
  };
}

function temporarySshPassword(config: TemporarySshLinkConfig) {
  return config.auth.type === "password" && config.auth.password
    ? config.auth.password
    : null;
}

function temporarySshPasswordSpecified(config: TemporaryLinkConfig) {
  return config.protocol === "ssh" && temporarySshPassword(config) !== null;
}

function createTemporaryTelnetConfig(
  host: string,
  port: number,
): TemporaryTelnetLinkConfig {
  return {
    protocol: "telnet",
    name: `telnet://${host}:${port}`,
    host,
    port,
  };
}

function normalizeHostForMatch(host: string): string {
  const trimmed = host.trim().replace(/^\[(.*)\]$/, "$1");
  if (!trimmed) return "";
  return trimmed.includes(":") ? trimmed : trimmed.toLowerCase();
}

function normalizePortForProtocol(
  port: number | undefined,
  protocol: ExternalNetworkOpenProtocol,
) {
  return port && Number.isInteger(port)
    ? port
    : protocol === "ssh"
      ? DEFAULT_SSH_PORT
      : DEFAULT_TELNET_PORT;
}

function parsePort(value: string | null, protocol: ExternalNetworkOpenProtocol) {
  if (!value)
    return protocol === "ssh" ? DEFAULT_SSH_PORT : DEFAULT_TELNET_PORT;
  if (!/^\d+$/.test(value)) return null;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function parseNyatermLocalUrl(params: URLSearchParams): ExternalOpenParseResult {
  for (const key of params.keys()) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "password") {
      return invalid(
        "externalOpen.inlinePassword",
        "inline_password",
        "nyaterm",
      );
    }
    if (normalizedKey !== "cwd") {
      return invalid(
        "externalOpen.unsupportedParameter",
        "unsupported_parameter",
        "nyaterm",
      );
    }
  }

  const workingDir = params.get("cwd");
  if (workingDir !== null && workingDir.trim() === "") {
    return invalid("externalOpen.invalidUrl", "empty_cwd", "nyaterm");
  }

  return {
    ok: true,
    intent: {
      protocol: "local",
      workingDir,
    },
  };
}

function mapTemporaryErrorKey(errorKey: string) {
  if (errorKey === "temporarySsh.inlinePassword")
    return "externalOpen.inlinePassword";
  if (errorKey === "temporarySsh.unsupportedOption")
    return "externalOpen.unsupportedParameter";
  if (errorKey === "temporarySsh.invalidPort")
    return "externalOpen.invalidPort";
  if (errorKey === "temporarySsh.invalidMode")
    return "externalOpen.invalidMode";
  if (errorKey === "temporarySsh.missingHost")
    return "externalOpen.missingHost";
  return "externalOpen.invalidUrl";
}

function temporaryErrorType(errorKey: string) {
  if (errorKey === "temporarySsh.inlinePassword") return "inline_password";
  if (errorKey === "temporarySsh.unsupportedOption")
    return "unsupported_parameter";
  if (errorKey === "temporarySsh.invalidPort") return "invalid_port";
  if (errorKey === "temporarySsh.invalidMode") return "invalid_mode";
  if (errorKey === "temporarySsh.missingHost") return "missing_host";
  return "invalid_url";
}

function invalid(
  errorKey: string,
  errorType: string,
  scheme?: string,
): ExternalOpenParseResult {
  return { ok: false, errorKey, errorType, scheme };
}

function schemeOf(value: string) {
  const index = value.indexOf(":");
  if (index <= 0) return null;
  const scheme = value.slice(0, index);
  if (!/^[a-z][a-z0-9+.-]*$/i.test(scheme)) return null;
  return scheme.toLowerCase();
}

function hasInvalidExplicitUrlPort(value: string) {
  const authority = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1];
  if (!authority) return false;
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  let portText: string | null = null;

  if (hostPort.startsWith("[")) {
    const end = hostPort.indexOf("]");
    if (end >= 0 && hostPort[end + 1] === ":") {
      portText = hostPort.slice(end + 2);
    }
  } else {
    const colonCount = (hostPort.match(/:/g) ?? []).length;
    if (colonCount === 1) {
      portText = hostPort.slice(hostPort.indexOf(":") + 1);
    }
  }

  if (portText === null) return false;
  if (!/^\d+$/.test(portText)) return true;
  const port = Number(portText);
  return !Number.isInteger(port) || port < 1 || port > 65535;
}
