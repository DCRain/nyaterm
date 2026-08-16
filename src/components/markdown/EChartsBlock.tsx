import * as echarts from "echarts";
import { useEffect, useMemo, useRef } from "react";
import type { NoteColors } from "@/lib/themes";
import { cn } from "@/lib/utils";

interface EChartsBlockProps {
  source: string;
  colors: NoteColors;
  className?: string;
}

function parseOption(source: string): echarts.EChartsOption {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error("Empty chart option");
  }
  const parsed: unknown = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Chart option must be a JSON object");
  }
  return parsed as echarts.EChartsOption;
}

export default function EChartsBlock({ source, colors, className }: EChartsBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => {
    try {
      return { option: parseOption(source), error: null as string | null };
    } catch (err) {
      return {
        option: null as echarts.EChartsOption | null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [source]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !parsed.option) return;

    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    chart.setOption(
      {
        backgroundColor: "transparent",
        textStyle: { color: colors.text },
        ...parsed.option,
      },
      { notMerge: true },
    );

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, [parsed.option, colors]);

  if (parsed.error) {
    return (
      <pre
        className={cn("my-3 overflow-auto rounded-md border p-3 text-xs", className)}
        style={{
          borderColor: colors.border,
          backgroundColor: colors.bgHover,
          color: colors.danger,
        }}
      >
        ECharts: {parsed.error}
      </pre>
    );
  }

  return (
    <div
      className={cn("nyaterm-echarts my-3 overflow-hidden rounded-md border p-2", className)}
      style={{
        borderColor: colors.border,
        backgroundColor: colors.bg,
      }}
    >
      <div ref={containerRef} className="h-[280px] w-full min-w-0" />
    </div>
  );
}
