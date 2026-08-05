import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@/lib/invoke";
import type { RemoteGpuOverview } from "@/types/global";

const MAX_CONSECUTIVE_FAILURES = 3;

export interface RemoteGpuOverviewState {
  overview: RemoteGpuOverview | null;
  error: boolean;
  isManualRefreshing: boolean;
  refresh: () => void;
}

export function useRemoteGpuOverview(
  activeSessionId: string | null,
  enabled: boolean,
  intervalSeconds: number,
): RemoteGpuOverviewState {
  const [overview, setOverview] = useState<RemoteGpuOverview | null>(null);
  const [error, setError] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchingRef = useRef(false);
  const failCountRef = useRef(0);
  const pollIntervalMs = Math.max(3, intervalSeconds) * 1000;

  const fetchOverview = useCallback(async (sessionId: string, manual = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (manual) setIsManualRefreshing(true);

    try {
      const data = await invoke<RemoteGpuOverview>("get_remote_gpu_overview", { sessionId });
      setOverview(data);
      setError(false);
      failCountRef.current = 0;
    } catch {
      failCountRef.current += 1;
      setError(true);
      if (failCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
        setOverview(null);
      }
    } finally {
      fetchingRef.current = false;
      if (manual) setIsManualRefreshing(false);
    }
  }, []);

  const refresh = useCallback(() => {
    if (!enabled || !activeSessionId) return;
    void fetchOverview(activeSessionId, true);
  }, [activeSessionId, enabled, fetchOverview]);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    if (!enabled || !activeSessionId) {
      setOverview(null);
      setError(false);
      failCountRef.current = 0;
      return;
    }

    void fetchOverview(activeSessionId);
    pollRef.current = setInterval(() => fetchOverview(activeSessionId), pollIntervalMs);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeSessionId, enabled, fetchOverview, pollIntervalMs]);

  return { overview, error, isManualRefreshing, refresh };
}
