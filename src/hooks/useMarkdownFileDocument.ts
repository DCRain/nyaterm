import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@/lib/invoke";

const AUTOSAVE_DEBOUNCE_MS = 800;

interface UseMarkdownFileDocumentOptions {
  filePath: string | null;
  onTitleChange?: (title: string) => void;
  onMarkdownApplied?: (markdown: string) => void;
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const base = normalized.split("/").pop() || path;
  return base.replace(/\.(md|markdown)$/i, "") || base;
}

export function useMarkdownFileDocument({
  filePath,
  onTitleChange,
  onMarkdownApplied,
}: UseMarkdownFileDocumentOptions) {
  const [title, setTitle] = useState(() => (filePath ? fileNameFromPath(filePath) : ""));
  const [markdown, setMarkdown] = useState("");
  const [status, setStatus] = useState<"saved" | "saving" | "unsaved" | "failed" | "loading">(
    filePath ? "loading" : "saved",
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(filePath));
  const [ready, setReady] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const markdownRef = useRef("");
  const mtimeRef = useRef<number | undefined>(undefined);
  const sizeRef = useRef<number | undefined>(undefined);

  const loadFile = useCallback(
    async (applyToEditor = true) => {
      if (!filePath) return;
      setLoading(true);
      setError("");
      try {
        const file = await invoke<{
          path: string;
          content: string;
          size: number;
          mtime: number;
        }>("read_user_text_file", { path: filePath, maxBytes: 20 * 1024 * 1024 });
        markdownRef.current = file.content;
        mtimeRef.current = file.mtime;
        sizeRef.current = file.size;
        setMarkdown(file.content);
        const nextTitle = fileNameFromPath(filePath);
        setTitle(nextTitle);
        onTitleChange?.(nextTitle);
        setStatus("saved");
        setReady(true);
        if (applyToEditor) {
          onMarkdownApplied?.(file.content);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("failed");
        setReady(false);
      } finally {
        setLoading(false);
      }
    },
    [filePath, onMarkdownApplied, onTitleChange],
  );

  useEffect(() => {
    if (!filePath) {
      setReady(false);
      setLoading(false);
      setMarkdown("");
      setTitle("");
      setStatus("saved");
      setError("");
      return;
    }
    void loadFile(true);
  }, [filePath, loadFile]);

  const flushSave = useCallback(async () => {
    if (!filePath) return false;
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setStatus("saving");
    setError("");
    try {
      await invoke("write_user_text_file", {
        path: filePath,
        content: markdownRef.current,
      });
      setStatus("saved");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("failed");
      return false;
    }
  }, [filePath]);

  const handleMarkdownChange = useCallback(
    (next: string) => {
      markdownRef.current = next;
      setMarkdown(next);
      setStatus("unsaved");
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        void flushSave();
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      setTitle(value);
      onTitleChange?.(value.trim() || (filePath ? fileNameFromPath(filePath) : ""));
    },
    [filePath, onTitleChange],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, []);

  return {
    title,
    markdown,
    status,
    error,
    loading,
    ready,
    filePath,
    loadFile,
    flushSave,
    handleMarkdownChange,
    handleTitleChange,
    setTitle,
  };
}
