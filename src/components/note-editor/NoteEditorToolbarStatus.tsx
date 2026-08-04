import { cn } from "@/lib/utils";

export type NoteSaveStatus = "saved" | "saving" | "unsaved" | "failed" | "external" | "deleted";

interface NoteEditorToolbarStatusProps {
  status: NoteSaveStatus;
  labels: Record<NoteSaveStatus, string>;
  className?: string;
}

export default function NoteEditorToolbarStatus({
  status,
  labels,
  className,
}: NoteEditorToolbarStatusProps) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm px-2 py-0.5 text-[11px]",
        status === "failed" || status === "deleted"
          ? "bg-destructive/10 text-destructive"
          : status === "external"
            ? "bg-amber-500/10 text-amber-500"
            : "text-muted-foreground",
        className,
      )}
    >
      {labels[status]}
    </span>
  );
}
