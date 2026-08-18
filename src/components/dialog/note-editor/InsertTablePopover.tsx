import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 3;
const MAX_ROWS = 10;
const MAX_COLS = 10;

interface InsertTablePopoverProps {
  onInsert: (rows: number, cols: number) => void;
  icon: React.ReactNode;
  label: string;
}

export default function InsertTablePopover({
  onInsert,
  icon,
  label,
}: InsertTablePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hoverRows, setHoverRows] = useState(DEFAULT_ROWS);
  const [hoverCols, setHoverCols] = useState(DEFAULT_COLS);
  const gridRef = useRef<HTMLDivElement>(null);

  const handleCellMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.min(Math.floor(x / (rect.width / MAX_COLS)), MAX_COLS - 1);
    const row = Math.min(Math.floor(y / (rect.height / MAX_ROWS)), MAX_ROWS - 1);
    setHoverCols(col + 1);
    setHoverRows(row + 1);
  }, []);

  const handleInsert = () => {
    onInsert(hoverRows, hoverCols);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={label}
          aria-label={label}
          className="h-7 w-7 hover:text-[var(--df-text)]"
          style={{ color: "var(--df-text-muted)" }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {icon}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        className="w-auto border-[var(--df-border)] bg-[var(--df-bg-panel)] p-2 text-[var(--df-text)]"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div
          ref={gridRef}
          className="grid gap-px rounded-md border border-[var(--df-border)] bg-[var(--df-border)] p-px"
          style={{
            gridTemplateColumns: `repeat(${MAX_COLS}, 1fr)`,
            width: "10rem",
            height: "10rem",
          }}
          onMouseMove={handleCellMouseMove}
          onMouseLeave={() => {
            setHoverRows(DEFAULT_ROWS);
            setHoverCols(DEFAULT_COLS);
          }}
        >
          {Array.from({ length: MAX_ROWS * MAX_COLS }).map((_, i) => {
            const row = Math.floor(i / MAX_COLS);
            const col = i % MAX_COLS;
            const isActive = row < hoverRows && col < hoverCols;
            return (
              <div
                key={i}
                className={`aspect-square cursor-pointer rounded-sm transition-colors ${
                  isActive
                    ? "bg-primary/50"
                    : "bg-muted/40 hover:bg-muted"
                }`}
                onClick={handleInsert}
              />
            );
          })}
        </div>
        <div className="mt-2 text-center text-xs text-muted-foreground">
          {hoverRows} {t("notes.toolbar.tableRows")} × {hoverCols} {t("notes.toolbar.tableCols")}
        </div>
      </PopoverContent>
    </Popover>
  );
}
