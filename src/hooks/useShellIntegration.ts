import { useRef } from "react";
import type { IMarker } from "@xterm/xterm";

export interface ShellIntegrationState {
  enabled: boolean;
  commandRunning: boolean;
}

export function useShellIntegration() {
  const shellIntegrationRef = useRef<ShellIntegrationState>({
    enabled: false,
    commandRunning: false,
  });
  const commandMarkersRef = useRef<IMarker[]>([]);

  const pushCommandMarker = (marker: IMarker) => {
    commandMarkersRef.current.push(marker);
  };

  const clearCommandMarkers = () => {
    for (const marker of commandMarkersRef.current) {
      marker.dispose();
    }
    commandMarkersRef.current = [];
  };

  return { shellIntegrationRef, commandMarkersRef, pushCommandMarker, clearCommandMarkers };
}