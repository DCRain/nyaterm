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
  const unavailableSessionRef = useRef<string | null>(null);
  const pollIntervalMs = Math.max(3, intervalSeconds) * 1000;

  const fetchOverview = useCallback(async (sessionId: string, manual = false) => {
    if (!manual && unavailableSessionRef.current === sessionId) return null;
    if (fetchingRef.current) return null;
    fetchingRef.current = true;
    if (manual) setIsManualRefreshing(true);

    try {
      const data = await invoke<RemoteGpuOverview>("get_remote_gpu_overview", { sessionId });
      setOverview(data);
      setError(false);
      failCountRef.current = 0;

      if (data.available) {
        unavailableSessionRef.current = null;
      } else {
        unavailableSessionRef.current = sessionId;
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }

      return data;
    } catch {
      failCountRef.current += 1;
      setError(true);
      if (failCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
        setOverview(null);
      }
      return null;
    } finally {
      fetchingRef.current = false;
      if (manual) setIsManualRefreshing(false);
    }
  }, []);

  const refresh = useCallback(() => {
    if (!enabled || !activeSessionId) return;
    void fetchOverview(activeSessionId, true).then((data) => {
      if (!data?.available || pollRef.current) return;
      pollRef.current = setInterval(() => fetchOverview(activeSessionId), pollIntervalMs);
    });
  }, [activeSessionId, enabled, fetchOverview, pollIntervalMs]);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    if (!enabled || !activeSessionId) {
      setOverview(null);
      setError(false);
      failCountRef.current = 0;
      unavailableSessionRef.current = null;
      return;
    }

    if (unavailableSessionRef.current !== activeSessionId) {
      void fetchOverview(activeSessionId);
    }
    if (unavailableSessionRef.current === activeSessionId) return;

    pollRef.current = setInterval(() => fetchOverview(activeSessionId), pollIntervalMs);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeSessionId, enabled, fetchOverview, pollIntervalMs]);

  return { overview, error, isManualRefreshing, refresh };
}
