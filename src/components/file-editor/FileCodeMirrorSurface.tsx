import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { ThemeColors } from "@/lib/themes";

const CTRL_WHEEL_ZOOM_THROTTLE_MS = 50;

export interface FileCodeMirrorSurfaceProps {
  /**
   * EditorState used for the very first mount only. Later tab switches / theme
   * changes are applied imperatively by the caller via `view.setState(...)`/
   * `view.dispatch(...)` on the `EditorView` handed back through `onReady` —
   * this component never remounts once created.
   */
  initialState: EditorState;
  /** UI theme colors (literal, non-CSS-variable) used for the host background. */
  colors: ThemeColors;
  fontSize: number;
  className?: string;
  onReady?: (view: EditorView) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}

/**
 * Mounts a CodeMirror `EditorView` directly into the host div — no iframe.
 *
 * A previous version of this component rendered inside a `doc.write`-created
 * same-origin iframe (mirroring `NoteMarkdownEditor`, which needs that
 * isolation because it can render inside a translucent/acrylic main window).
 * The file editor is always opened as its own fully opaque native child
 * window (`transparent: false`, see `windowManager.ts` / `cmd/app.rs`), so
 * that isolation isn't needed here — and the extra document boundary turned
 * out to be actively harmful in release WebView2 builds: `doc.write`d
 * documents plus CodeMirror's own dynamically-appended `StyleModule`
 * `<style>` tags were unreliable (no syntax highlighting), and the
 * corrective inline-style clamp used to fight release layout bugs visibly
 * flashed on every keystroke/selection change. Mounting directly avoids the
 * whole cross-document sync problem — CodeMirror's `StyleModule` mounts into
 * `document.head` exactly like any other component's CSS-in-JS.
 */
export default function FileCodeMirrorSurface({
  initialState,
  colors,
  fontSize,
  className,
  onReady,
  onZoomIn,
  onZoomOut,
}: FileCodeMirrorSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialStateRef = useRef(initialState);
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onZoomInRef = useRef(onZoomIn);
  onZoomInRef.current = onZoomIn;
  const onZoomOutRef = useRef(onZoomOut);
  onZoomOutRef.current = onZoomOut;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      parent: host,
      state: initialStateRef.current,
    });
    view.dom.style.setProperty("height", "100%", "important");
    view.dom.style.setProperty("width", "100%", "important");
    view.dom.style.setProperty("font-size", `${fontSizeRef.current}px`, "important");
    view.dom.style.setProperty("border", "none", "important");
    view.dom.style.setProperty("outline", "none", "important");
    view.dom.style.setProperty("box-shadow", "none", "important");
    viewRef.current = view;
    onReadyRef.current?.(view);
    window.requestAnimationFrame(() => view.requestMeasure());

    let lastWheelZoomAt = 0;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.deltaY === 0) return;
      event.preventDefault();
      const now = Date.now();
      if (now - lastWheelZoomAt < CTRL_WHEEL_ZOOM_THROTTLE_MS) return;
      lastWheelZoomAt = now;
      if (event.deltaY < 0) onZoomInRef.current?.();
      else onZoomOutRef.current?.();
    };
    host.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      host.removeEventListener("wheel", handleWheel);
      view.destroy();
      if (viewRef.current === view) viewRef.current = null;
    };
    // Mount once; tab/theme swaps happen imperatively via the EditorView handed to onReady.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live font-size updates (Ctrl+wheel zoom / settings) without remounting or
  // rebuilding editor state — same document, so a plain inline style suffices.
  useEffect(() => {
    viewRef.current?.dom.style.setProperty("font-size", `${fontSize}px`, "important");
  }, [fontSize]);

  return (
    <div
      ref={hostRef}
      className={className ?? "absolute inset-0 min-h-0 min-w-0 overflow-hidden"}
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
      }}
    />
  );
}
