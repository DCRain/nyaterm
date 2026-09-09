import { useTranslation } from "react-i18next";
import type { NetworkHistoryPoint } from "@/hooks/useNetworkHistory";

const VIEWBOX_WIDTH = 300;
const VIEWBOX_HEIGHT = 84;
const CHART_LEFT = 4;
const CHART_RIGHT = VIEWBOX_WIDTH - 4;
const CHART_TOP = 22;
const CHART_BOTTOM = VIEWBOX_HEIGHT - 6;

export function formatNetworkRate(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  const i = Math.min(Math.floor(Math.log(bytesPerSec) / Math.log(1024)), units.length - 1);
  const val = bytesPerSec / 1024 ** i;
  return `${val < 10 ? val.toFixed(1) : val.toFixed(0)} ${units[i]}`;
}

function toPolyline(
  points: NetworkHistoryPoint[],
  key: "rx" | "tx",
  maxValue: number,
): string {
  const width = CHART_RIGHT - CHART_LEFT;
  const height = CHART_BOTTOM - CHART_TOP;
  const lastIndex = Math.max(points.length - 1, 1);

  return points
    .map((point, index) => {
      const x = CHART_LEFT + (index / lastIndex) * width;
      const y = CHART_BOTTOM - (Math.max(0, point[key]) / maxValue) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

interface NetworkTrafficChartProps {
  points: NetworkHistoryPoint[];
}

export default function NetworkTrafficChart({ points }: NetworkTrafficChartProps) {
  const { t } = useTranslation();

  if (points.length < 2) {
    return (
      <div
        className="flex h-[84px] items-center justify-center rounded-md border text-[0.6875rem]"
        style={{
          borderColor: "color-mix(in srgb, var(--df-border) 60%, transparent)",
          color: "var(--df-text-dimmed)",
        }}
      >
        {t("resourceMonitor.collectingNetworkHistory")}
      </div>
    );
  }

  const maxValue = Math.max(
    1,
    ...points.flatMap((point) => [Math.max(0, point.rx), Math.max(0, point.tx)]),
  );
  const rxPoints = toPolyline(points, "rx", maxValue);
  const txPoints = toPolyline(points, "tx", maxValue);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[0.625rem]">
        <div className="flex items-center gap-2" style={{ color: "var(--df-text-dimmed)" }}>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> RX
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> TX
          </span>
        </div>
        <span className="font-mono tabular-nums" style={{ color: "var(--df-text-dimmed)" }}>
          {t("resourceMonitor.maxRate", { value: formatNetworkRate(maxValue) })}
        </span>
      </div>
      <svg
        className="h-[84px] w-full rounded-md border"
        style={{ borderColor: "color-mix(in srgb, var(--df-border) 60%, transparent)" }}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t("resourceMonitor.networkHistory")}
      >
        <line
          x1={CHART_LEFT}
          y1={CHART_BOTTOM}
          x2={CHART_RIGHT}
          y2={CHART_BOTTOM}
          stroke="color-mix(in srgb, var(--df-border) 70%, transparent)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={rxPoints}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={txPoints}
          fill="none"
          stroke="#22c55e"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
