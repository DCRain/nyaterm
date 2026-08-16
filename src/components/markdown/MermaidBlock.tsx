import { useEffect, useId, useState } from "react";
import type { NoteColors } from "@/lib/themes";
import { cn } from "@/lib/utils";

interface MermaidBlockProps {
  source: string;
  colors: NoteColors;
  className?: string;
}

function buildMermaidTheme(colors: NoteColors) {
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    theme: "base" as const,
    themeVariables: {
      darkMode: false,
      background: colors.bgPanel,
      primaryColor: colors.bgHover,
      primaryTextColor: colors.text,
      primaryBorderColor: colors.border,
      secondaryColor: colors.bg,
      secondaryTextColor: colors.text,
      secondaryBorderColor: colors.border,
      tertiaryColor: colors.bgPanel,
      tertiaryTextColor: colors.textMuted,
      tertiaryBorderColor: colors.border,
      lineColor: colors.textMuted,
      textColor: colors.text,
      mainBkg: colors.bgHover,
      nodeBorder: colors.border,
      clusterBkg: colors.bg,
      clusterBorder: colors.border,
      titleColor: colors.text,
      edgeLabelBackground: colors.bgPanel,
      actorBkg: colors.bgHover,
      actorBorder: colors.border,
      actorTextColor: colors.text,
      actorLineColor: colors.textMuted,
      signalColor: colors.text,
      signalTextColor: colors.text,
      labelBoxBkgColor: colors.bgHover,
      labelBoxBorderColor: colors.border,
      labelTextColor: colors.text,
      loopTextColor: colors.text,
      noteBkgColor: colors.bgHover,
      noteTextColor: colors.text,
      noteBorderColor: colors.border,
      activationBkgColor: colors.bgHover,
      activationBorderColor: colors.primary,
      sequenceNumberColor: colors.bgPanel,
      sectionBkgColor: colors.bgHover,
      altSectionBkgColor: colors.bg,
      sectionBkgColor2: colors.bgPanel,
      taskBkgColor: colors.primary,
      taskBorderColor: colors.primary,
      taskTextColor: colors.bgPanel,
      taskTextDarkColor: colors.text,
      taskTextOutsideColor: colors.text,
      taskTextLightColor: colors.bgPanel,
      gridColor: colors.border,
      todayLineColor: colors.danger,
      doneTaskBkgColor: colors.textMuted,
      doneTaskBorderColor: colors.textMuted,
      activeTaskBkgColor: colors.primary,
      activeTaskBorderColor: colors.primary,
      critBkgColor: colors.danger,
      critBorderColor: colors.danger,
      fontFamily: "inherit",
    },
  };
}

export default function MermaidBlock({ source, colors, className }: MermaidBlockProps) {
  const reactId = useId().replace(/:/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const trimmed = source.trim();
    if (!trimmed) {
      setSvg(null);
      setError(null);
      return;
    }

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize(buildMermaidTheme(colors));
        const { svg: rendered } = await mermaid.render(`nyaterm-mermaid-${reactId}`, trimmed);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setSvg(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, colors, reactId]);

  if (error) {
    return (
      <pre
        className={cn("my-3 overflow-auto rounded-md border p-3 text-xs", className)}
        style={{
          borderColor: colors.border,
          backgroundColor: colors.bgHover,
          color: colors.danger,
        }}
      >
        Mermaid: {error}
      </pre>
    );
  }

  if (!svg) {
    return (
      <div
        className={cn("my-3 rounded-md border px-3 py-6 text-center text-xs", className)}
        style={{
          borderColor: colors.border,
          backgroundColor: colors.bgHover,
          color: colors.textMuted,
        }}
      >
        …
      </div>
    );
  }

  return (
    <div
      className={cn(
        "nyaterm-mermaid my-3 overflow-auto rounded-md border p-3 [&_svg]:mx-auto [&_svg]:max-w-full",
        className,
      )}
      style={{
        borderColor: colors.border,
        backgroundColor: colors.bg,
      }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid SVG from local render with securityLevel strict
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
