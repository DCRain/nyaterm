import { isWindows } from "@/lib/platform";
import type { SshAgentEndpoint } from "@/types/global";

export const MAX_SSH_AGENT_FORWARDING_ENDPOINTS = 16;
export const MAX_SSH_AGENT_FORWARDING_IDENTITIES = 1024;

const MAX_SSH_AGENT_ENVIRONMENT_VARIABLE_BYTES = 255;
const MAX_SSH_AGENT_UNIX_SOCKET_PATH_BYTES = 4096;

export type SshAgentEndpointValidationError =
  | "empty"
  | "invalid"
  | "too_long"
  | "duplicate"
  | "too_many";

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function normalizeEnvironmentVariable(value: string): string {
  return value.trim().replace(/^\$+/, "").trim();
}

function endpointKey(endpoint: SshAgentEndpoint): string {
  switch (endpoint.type) {
    case "auto":
      return isWindows ? "auto" : "environment:SSH_AUTH_SOCK";
    case "environment":
      return `environment:${normalizeEnvironmentVariable(endpoint.variable)}`;
    case "unix_socket":
      return `unix_socket:${endpoint.path}`;
    case "pageant":
      return "pageant";
    case "windows_open_ssh":
      return "windows_open_ssh";
  }
}

/** Mirrors the backend save-boundary checks so invalid endpoint drafts are visible immediately. */
export function validateSshAgentForwardingEndpoints(
  endpoints: SshAgentEndpoint[],
): SshAgentEndpointValidationError | null {
  if (endpoints.length > MAX_SSH_AGENT_FORWARDING_ENDPOINTS) {
    return "too_many";
  }

  const seen = new Set<string>();
  for (const endpoint of endpoints) {
    if (endpoint.type === "environment") {
      const variable = normalizeEnvironmentVariable(endpoint.variable);
      if (!variable) return "empty";
      if (variable.includes("=") || variable.includes("\0")) return "invalid";
      if (utf8Length(variable) > MAX_SSH_AGENT_ENVIRONMENT_VARIABLE_BYTES) return "too_long";
    }
    if (endpoint.type === "unix_socket") {
      if (endpoint.path.includes("\0")) return "invalid";
      if (!endpoint.path.trim()) return "empty";
      if (utf8Length(endpoint.path) > MAX_SSH_AGENT_UNIX_SOCKET_PATH_BYTES) return "too_long";
    }

    if (!seen.add(endpointKey(endpoint))) {
      return "duplicate";
    }
  }

  return null;
}
