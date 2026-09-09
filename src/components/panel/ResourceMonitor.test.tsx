import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NetworkHistorySeries, NetworkHistoryStore } from "@/hooks/useNetworkHistory";
import type { RemoteStatsState } from "@/hooks/useRemoteStats";
import type { RemoteStats } from "@/types/global";
import ResourceMonitor from "./ResourceMonitor";

const mocks = vi.hoisted(() => ({ chart: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        "panel.resourceMonitor": "Resources",
        "resourceMonitor.allInterfaces": "All interfaces",
        "resourceMonitor.download": "Download",
        "resourceMonitor.upload": "Upload",
        "resourceMonitor.nic": "NIC",
        "resourceMonitor.network": "Network",
      };
      if (key === "resourceMonitor.recentMinutes") return `Recent ${options?.count} min`;
      return labels[key] ?? key;
    },
  }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("./NetworkTrafficChart", () => ({
  default: (props: { points: unknown[] }) => {
    mocks.chart(props);
    return <div data-testid="network-chart" />;
  },
  formatNetworkRate: (value: number) => `${value} B/s`,
}));

describe("ResourceMonitor network selector", () => {
  it("defaults to summary, switches to a NIC, and falls back when the NIC disappears", async () => {
    const summary = historyPoints(1000, 2000);
    const eth0 = historyPoints(100, 200);
    const history: NetworkHistorySeries = {
      summary,
      interfaces: { eth0, docker0: historyPoints(300, 400) },
    };
    const { rerender } = renderMonitor("session-a", statsWithNetworks(["eth0", "docker0"]), history);

    expect(selectValue()).toBe("__all__");
    expect(screen.queryByText("1000 B/s")).not.toBeNull();
    expect(screen.queryByText("2000 B/s")).not.toBeNull();
    expect(mocks.chart).toHaveBeenLastCalledWith({ points: summary });

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "eth0" } });
    expect(screen.queryByText("100 B/s")).not.toBeNull();
    expect(screen.queryByText("200 B/s")).not.toBeNull();
    expect(mocks.chart).toHaveBeenLastCalledWith({ points: eth0 });

    rerender(resourceMonitor("session-a", statsWithNetworks(["docker0"]), history));
    await waitFor(() => expect(selectValue()).toBe("__all__"));

    rerender(resourceMonitor("session-a", statsWithNetworks(["eth0", "docker0"]), history));
    expect(selectValue()).toBe("__all__");
    expect(mocks.chart).toHaveBeenLastCalledWith({ points: summary });
  });

  it("keeps NIC selection isolated per session", () => {
    const history: NetworkHistorySeries = {
      summary: historyPoints(1000, 2000),
      interfaces: {
        eth0: historyPoints(100, 200),
        docker0: historyPoints(300, 400),
      },
    };
    const { rerender } = renderMonitor("session-a", statsWithNetworks(["eth0", "docker0"]), history);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "eth0" } });
    expect(selectValue()).toBe("eth0");

    rerender(resourceMonitor("session-b", statsWithNetworks(["eth0", "docker0"]), history));
    expect(selectValue()).toBe("__all__");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "docker0" } });
    expect(selectValue()).toBe("docker0");

    rerender(resourceMonitor("session-a", statsWithNetworks(["eth0", "docker0"]), history));
    expect(selectValue()).toBe("eth0");
  });
});

function selectValue() {
  return (screen.getByRole("combobox") as HTMLSelectElement).value;
}

function renderMonitor(
  sessionId: string,
  stats: RemoteStats,
  networkHistory: NetworkHistorySeries,
) {
  return render(resourceMonitor(sessionId, stats, networkHistory));
}

function resourceMonitor(
  sessionId: string,
  stats: RemoteStats,
  networkHistory: NetworkHistorySeries,
) {
  const remoteStats: RemoteStatsState = {
    sessionId,
    stats,
    error: false,
    isManualRefreshing: false,
    refresh: vi.fn(),
  };
  return (
    <ResourceMonitor
      activeSessionId={sessionId}
      enabled
      remoteStats={remoteStats}
      networkHistoryStore={historyStore(networkHistory)}
    />
  );
}

function historyStore(networkHistory: NetworkHistorySeries): NetworkHistoryStore {
  return {
    getSeries: () => networkHistory,
    subscribe: () => () => {},
  };
}

function historyPoints(rx: number, tx: number) {
  return [
    { timestamp: 1000, rx, tx },
    { timestamp: 4000, rx: rx * 2, tx: tx * 2 },
  ];
}

function statsWithNetworks(nics: string[]): RemoteStats {
  const rates: Record<string, { rx: number; tx: number }> = {
    eth0: { rx: 100, tx: 200 },
    docker0: { rx: 300, tx: 400 },
  };
  return {
    system: { hostname: "host", uptime_sec: 100, os: "Linux", arch: "x86_64" },
    load: { load1: 0.1, load5: 0.2, load15: 0.3 },
    cpu: {
      model: "CPU",
      cores: 8,
      usage: 10,
      per_core: [],
      sample_window_ms: 1000,
      usage_source: "aggregate",
    },
    memory: { used: 1024, available: 1024, cached: 0 },
    networks: nics.map((nic) => ({
      nic,
      state: "up",
      rx_bytes_per_sec: rates[nic]?.rx ?? 0,
      tx_bytes_per_sec: rates[nic]?.tx ?? 0,
    })),
    network_summary: { rx_bytes_per_sec: 1000, tx_bytes_per_sec: 2000 },
    disks: [],
  };
}
