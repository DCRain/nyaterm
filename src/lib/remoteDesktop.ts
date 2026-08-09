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
