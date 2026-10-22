import { invoke } from "@/lib/invoke";
import type { SavedConnection } from "@/types/global";

export type RemoteDesktopProtocol = "rdp" | "vnc";

export interface RemoteDesktopClientInfo {
  id: string;
  name: string;
  available: boolean;
  path?: string;
  install_hint?: string;
  download_url?: string;
}

export interface RemoteDesktopClientInstallRecommendation {
  id: string;
  name: string;
  install_hint: string;
  download_url?: string;
}

export type LaunchRemoteDesktopResult =
  | {
      status: "launched";
      client_id: string;
      client_name: string;
    }
  | {
      status: "missing_client";
      protocol: RemoteDesktopProtocol;
      recommendations: RemoteDesktopClientInstallRecommendation[];
    };

export function isRemoteDesktopConnection(
  connection: Pick<SavedConnection, "type"> | null | undefined,
): connection is Pick<SavedConnection, "type"> & { type: RemoteDesktopProtocol } {
  return connection?.type === "rdp" || connection?.type === "vnc";
}

/**
 * Whether to open via the legacy `launch_remote_desktop` path (mstsc/FreeRDP auto-select).
 * Prefers `rdp_client_mode` when set so builtin/windows are not misrouted by the default
 * legacy `client_mode: "external"`. Unset `rdp_client_mode` keeps the old `client_mode` check.
 */
export function shouldLaunchExternalRemoteDesktop(
  connection: Pick<SavedConnection, "type" | "client_mode" | "rdp_client_mode"> | null | undefined,
): boolean {
  if (!connection) return false;
  if (connection.type === "vnc") return true;
  if (connection.type !== "rdp") return false;
  // Explicit per-connection modes take the dedicated paths (IronRDP / launch_windows_rdp).
  if (connection.rdp_client_mode === "builtin" || connection.rdp_client_mode === "windows") {
    return false;
  }
  // Legacy connections without rdp_client_mode: external unless client_mode is builtin.
  return connection.client_mode !== "builtin";
}

export async function listRemoteDesktopClients(
  protocol: RemoteDesktopProtocol,
): Promise<RemoteDesktopClientInfo[]> {
  return invoke<RemoteDesktopClientInfo[]>("list_remote_desktop_clients", { protocol });
}

export async function launchSavedRemoteDesktop(
  connection: Pick<SavedConnection, "id" | "type">,
): Promise<LaunchRemoteDesktopResult> {
  return invoke<LaunchRemoteDesktopResult>("launch_remote_desktop", {
    request: { connectionId: connection.id },
  });
}
