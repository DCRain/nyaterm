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

/** VNC always external; RDP external unless explicitly set to builtin IronRDP. */
export function shouldLaunchExternalRemoteDesktop(
  connection: Pick<SavedConnection, "type" | "client_mode"> | null | undefined,
): boolean {
  if (!connection) return false;
  if (connection.type === "vnc") return true;
  if (connection.type === "rdp") {
    return connection.client_mode !== "builtin";
  }
  return false;
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
