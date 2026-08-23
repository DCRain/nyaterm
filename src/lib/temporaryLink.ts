export type {
  SshRuntimeMode,
  TemporaryLinkConfig,
  TemporaryLinkProtocol,
  TemporarySerialLinkConfig,
  TemporarySshLinkConfig,
  TemporaryTelnetLinkConfig,
} from "@/types/temporaryConnection";

import type {
  SshRuntimeMode,
  TemporaryLinkConfig,
  TemporaryLinkProtocol,
  TemporarySerialLinkConfig,
} from "@/types/temporaryConnection";

export type TemporaryLinkParseResult =
  | { ok: true; config: TemporaryLinkConfig }
  | { ok: false; errorKey: string };

const DEFAULT_USERNAME = "root";
const DEFAULT_SSH_PORT = 22;
const DEFAULT_TELNET_PORT = 23;
const UNSUPPORTED_OPTIONS = new Set([
  "-J",
  "-L",
  "-R",
  "-D",
  "-W",
  "-b",
  "-c",
  "-F",
  "-I",
  "-i",
  "-m",
  "-o",
  "-S",
  "-w",
]);
const UNSUPPORTED_LONG_OPTIONS = new Set([
  "proxyjump",
  "proxycommand",
  "localforward",
  "remoteforward",
  "dynamicforward",
  "identityfile",
]);

export function parseTemporaryLink(
  protocol: Exclude<TemporaryLinkProtocol, "serial">,
  input: string,
): TemporaryLinkParseResult {
  return protocol === "telnet"
    ? parseTemporaryTelnetLink(input)
    : parseTemporarySshLink(input);
}

export function parseTemporarySshLink(input: string): TemporaryLinkParseResult {
  const text = input.trim();
  if (!text) return { ok: false, errorKey: "temporarySsh.empty" };

  const urlResult = parseSshUrl(text);
  if (urlResult) return urlResult;

  const tokens = tokenizeShellLike(text);
  if (!tokens.length) return { ok: false, errorKey: "temporarySsh.empty" };

  const commandTokens = tokens[0] === "ssh" ? tokens.slice(1) : tokens;
  let username: string | null = null;
  let hostSpec: string | null = null;
  let port: number | null = null;

  for (let i = 0; i < commandTokens.length; i += 1) {
    const token = commandTokens[i];
    if (!token) continue;

    if (token === "--") {
      hostSpec = findHostSpec(commandTokens.slice(i + 1)) ?? hostSpec;
      break;
    }

    if (token === "-p") {
      const next = commandTokens[i + 1];
      if (isValidPortToken(next)) {
        port = Number(next);
        i += 1;
      }
      continue;
    }

    if (token.startsWith("-p") && token.length > 2) {
      const inlinePort = token.slice(2);
      if (isValidPortToken(inlinePort)) port = Number(inlinePort);
      continue;
    }

    if (token === "-l") {
      const next = commandTokens[i + 1];
      if (next && !next.startsWith("-") && !next.includes("@")) {
        username = next;
        i += 1;
      }
      continue;
    }

    if (token.startsWith("-l") && token.length > 2) {
      username = token.slice(2);
      continue;
    }

    if (isUnsupportedOption(token)) {
      return { ok: false, errorKey: "temporarySsh.unsupportedOption" };
    }

    if (token === "-o") {
      const next = commandTokens[i + 1];
      if (next && isUnsupportedOpenSshOption(next)) {
        return { ok: false, errorKey: "temporarySsh.unsupportedOption" };
      }
      i += 1;
      continue;
    }

    if (token.startsWith("-")) {
      if (optionConsumesValue(token)) i += 1;
      continue;
    }

    hostSpec = hostSpec ?? token;
  }

  if (!hostSpec) return { ok: false, errorKey: "temporarySsh.missingHost" };
  return buildConfig(hostSpec, username, port);
}

export function parseTemporaryTelnetLink(
  input: string,
): TemporaryLinkParseResult {
  const text = input.trim();
  if (!text) return { ok: false, errorKey: "temporarySsh.empty" };

  const urlResult = parseTelnetUrl(text);
  if (urlResult) return urlResult;

  const tokens = tokenizeShellLike(text);
  if (!tokens.length) return { ok: false, errorKey: "temporarySsh.empty" };

  const commandTokens =
    tokens[0]?.toLowerCase() === "telnet" ? tokens.slice(1) : tokens;
  let hostSpec: string | null = null;
  let port: number | null = null;

  for (let i = 0; i < commandTokens.length; i += 1) {
    const token = commandTokens[i];
    if (!token) continue;

    if (token === "--") {
      hostSpec = findHostSpec(commandTokens.slice(i + 1)) ?? hostSpec;
      break;
    }

    if (token.startsWith("-")) {
      continue;
    }

    if (!hostSpec) {
      hostSpec = token;
      continue;
    }

    if (port === null) {
      if (!/^\d+$/.test(token))
        return { ok: false, errorKey: "temporarySsh.invalidPort" };
      port = Number(token);
    }
  }

  if (!hostSpec) return { ok: false, errorKey: "temporarySsh.missingHost" };
  return buildTelnetConfig(hostSpec, port);
}

function parseSshUrl(text: string): TemporaryLinkParseResult | null {
  if (!/^ssh:\/\//i.test(text)) return null;

  try {
    const url = new URL(text);
    if (!url.hostname)
      return { ok: false, errorKey: "temporarySsh.missingHost" };
    const port = url.port ? Number(url.port) : DEFAULT_SSH_PORT;
    if (!isValidPort(port))
      return { ok: false, errorKey: "temporarySsh.invalidPort" };
    const runtimeMode = parseSshRuntimeMode(url.searchParams.get("mode"));
    if (!runtimeMode)
      return { ok: false, errorKey: "temporarySsh.invalidMode" };
    const password = url.password ? decodeURIComponent(url.password) : null;
    return createConfig(
      url.hostname,
      decodeURIComponent(url.username || DEFAULT_USERNAME),
      port,
      password,
      runtimeMode,
    );
  } catch {
    return { ok: false, errorKey: "temporarySsh.invalidInput" };
  }
}

function parseTelnetUrl(text: string): TemporaryLinkParseResult | null {
  if (!/^telnet:\/\//i.test(text)) return null;

  try {
    const url = new URL(text);
    if (url.username || url.password) {
      return { ok: false, errorKey: "temporarySsh.inlinePassword" };
    }
    if (!url.hostname)
      return { ok: false, errorKey: "temporarySsh.missingHost" };
    const port = url.port ? Number(url.port) : DEFAULT_TELNET_PORT;
    if (!isValidPort(port))
      return { ok: false, errorKey: "temporarySsh.invalidPort" };
    return createTelnetConfig(url.hostname, port);
  } catch {
    return { ok: false, errorKey: "temporarySsh.invalidInput" };
  }
}

function buildConfig(
  hostSpec: string,
  explicitUsername: string | null,
  explicitPort: number | null,
): TemporaryLinkParseResult {
  if (hostSpec.includes("://") && !/^ssh:\/\//i.test(hostSpec)) {
    return { ok: false, errorKey: "temporarySsh.invalidInput" };
  }

  if (/^[^@\s:]+:[^@\s]+@/.test(hostSpec)) {
    return { ok: false, errorKey: "temporarySsh.inlinePassword" };
  }

  let target = hostSpec;
  let username = explicitUsername;
  const atIndex = target.lastIndexOf("@");
  if (atIndex >= 0) {
    const userPart = target.slice(0, atIndex);
    if (userPart.includes(":"))
      return { ok: false, errorKey: "temporarySsh.inlinePassword" };
    username = userPart || username;
    target = target.slice(atIndex + 1);
  }

  const parsedTarget = parseHostPort(target);
  if (!parsedTarget.host)
    return { ok: false, errorKey: "temporarySsh.missingHost" };
  if (parsedTarget.port !== null && !isValidPort(parsedTarget.port)) {
    return { ok: false, errorKey: "temporarySsh.invalidPort" };
  }

  return createConfig(
    parsedTarget.host,
    username || DEFAULT_USERNAME,
    explicitPort ?? parsedTarget.port ?? DEFAULT_SSH_PORT,
  );
}

function buildTelnetConfig(
  hostSpec: string,
  explicitPort: number | null,
): TemporaryLinkParseResult {
  if (hostSpec.includes("://") && !/^telnet:\/\//i.test(hostSpec)) {
    return { ok: false, errorKey: "temporarySsh.invalidInput" };
  }

  if (hostSpec.includes("@")) {
    return { ok: false, errorKey: "temporarySsh.inlinePassword" };
  }

  const parsedTarget = parseHostPort(hostSpec);
  if (!parsedTarget.host)
    return { ok: false, errorKey: "temporarySsh.missingHost" };
  if (parsedTarget.port !== null && !isValidPort(parsedTarget.port)) {
    return { ok: false, errorKey: "temporarySsh.invalidPort" };
  }
  if (explicitPort !== null && !isValidPort(explicitPort)) {
    return { ok: false, errorKey: "temporarySsh.invalidPort" };
  }

  return createTelnetConfig(
    parsedTarget.host,
    explicitPort ?? parsedTarget.port ?? DEFAULT_TELNET_PORT,
  );
}

function createConfig(
  host: string,
  username: string,
  port: number,
  password: string | null = null,
  runtimeMode: SshRuntimeMode = "standard",
): Extract<TemporaryLinkParseResult, { ok: true }> {
  const normalizedHost = host.replace(/^\[(.*)\]$/, "$1");
  const name = `${username}@${normalizedHost}:${port}`;

  return {
    ok: true,
    config: {
      protocol: "ssh",
      runtime_mode: runtimeMode,
      name,
      host: normalizedHost,
      port,
      username,
      auth: { type: "password", password },
      backspace_mode: "del",
      x11_forwarding: false,
      x11_display: "",
      proxy: null,
      proxy_jump: null,
      post_login: null,
    },
  };
}

export function parseSshRuntimeMode(
  value: string | null,
): SshRuntimeMode | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return "standard";
  if (normalized === "standard" || normalized === "terminal") return normalized;
  return null;
}

function createTelnetConfig(
  host: string,
  port: number,
): Extract<TemporaryLinkParseResult, { ok: true }> {
  const normalizedHost = host.replace(/^\[(.*)\]$/, "$1");
  return {
    ok: true,
    config: {
      protocol: "telnet",
      name: `telnet://${normalizedHost}:${port}`,
      host: normalizedHost,
      port,
    },
  };
}

export function createTemporarySerialLinkConfig(
  portName: string,
  baudRate: number,
): TemporarySerialLinkConfig {
  return {
    protocol: "serial",
    name: `${portName} @ ${baudRate}`,
    portName,
    baudRate,
  };
}

function parseHostPort(target: string): { host: string; port: number | null } {
  if (target.startsWith("[")) {
    const end = target.indexOf("]");
    if (end === -1) return { host: target, port: null };
    const host = target.slice(1, end);
    const rest = target.slice(end + 1);
    if (rest.startsWith(":")) return { host, port: Number(rest.slice(1)) };
    return { host, port: null };
  }

  const colonCount = (target.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    const [host, portText] = target.split(":");
    return { host, port: portText ? Number(portText) : null };
  }

  return { host: target, port: null };
}

function tokenizeShellLike(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of text) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }

    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (/\s/.test(char) && !quote) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function findHostSpec(tokens: string[]) {
  return tokens.find((token) => token && !token.startsWith("-")) ?? null;
}

function isUnsupportedOption(token: string) {
  if (UNSUPPORTED_OPTIONS.has(token)) return true;
  if (/^-([LRDWbciFmOSw])/.test(token)) return true;
  if (!token.startsWith("-o")) return false;

  return isUnsupportedOpenSshOption(token.slice(2).replace(/^=/, ""));
}

function isUnsupportedOpenSshOption(optionText: string) {
  const option = optionText.split("=")[0].toLowerCase();
  return UNSUPPORTED_LONG_OPTIONS.has(option);
}

function optionConsumesValue(token: string) {
  return (
    token === "-A" ||
    token === "-a" ||
    token === "-E" ||
    token === "-e" ||
    token === "-Q"
  );
}

function isValidPortToken(value: string | undefined): value is string {
  return !!value && /^\d+$/.test(value) && isValidPort(Number(value));
}

function isValidPort(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}
