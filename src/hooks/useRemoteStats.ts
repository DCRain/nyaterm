import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@/lib/invoke";
import type { RemoteStats } from "@/types/global";

const MAX_CONSECUTIVE_FAILURES = 3;

export interface RemoteStatsState {
  stats: RemoteStats | null;
  error: boolean;
  isManualRefreshing: boolean;
  refresh: () => void;
}

export function useRemoteStats(
  activeSessionId: string | null,
  enabled: boolean,
  intervalSeconds: number,
): RemoteStatsState {
  const [stats, setStats] = useState<RemoteStats | null>(null);
  const [error, setError] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warmupRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warmupRetrySessionRef = useRef<string | null>(null);
  const fetchingRef = useRef(false);
  const failCountRef = useRef(0);
  const pollIntervalMs = Math.max(1, intervalSeconds) * 1000;

  const fetchStats = useCallback(async (sessionId: string, manual = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (manual) setIsManualRefreshing(true);

    try {
      const data = await invoke<RemoteStats>("get_remote_stats", { sessionId });
      setStats(data);
      setError(false);
      failCountRef.current = 0;

      if (warmupRefreshRef.current) {
        clearTimeout(warmupRefreshRef.current);
        warmupRefreshRef.current = null;
      }

      if (data.cpu.usage_source === "warming_up" && warmupRetrySessionRef.current !== sessionId) {
        warmupRetrySessionRef.current = sessionId;
        warmupRefreshRef.current = setTimeout(() => {
          warmupRefreshRef.current = null;
          void fetchStats(sessionId);
        }, 1000);
      } else if (data.cpu.usage_source !== "warming_up") {
        warmupRetrySessionRef.current = null;
      }
    } catch {
      failCountRef.current += 1;
      setError(true);
      if (failCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
        setStats(null);
      }
    } finally {
      fetchingRef.current = false;
      if (manual) setIsManualRefreshing(false);
    }
  }, []);

  const refresh = useCallback(() => {
    if (!enabled || !activeSessionId) return;
    void fetchStats(activeSessionId, true);
  }, [activeSessionId, enabled, fetchStats]);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (warmupRefreshRef.current) {
      clearTimeout(warmupRefreshRef.current);
      warmupRefreshRef.current = null;
    }

    if (!enabled || !activeSessionId) {
      setStats(null);
      setError(false);
      failCountRef.current = 0;
      warmupRetrySessionRef.current = null;
      return;
    }

    void fetchStats(activeSessionId);
    pollRef.current = setInterval(() => fetchStats(activeSessionId), pollIntervalMs);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (warmupRefreshRef.current) {
        clearTimeout(warmupRefreshRef.current);
        warmupRefreshRef.current = null;
      }
      warmupRetrySessionRef.current = null;
    };
  }, [activeSessionId, enabled, fetchStats, pollIntervalMs]);

  return { stats, error, isManualRefreshing, refresh };
}
