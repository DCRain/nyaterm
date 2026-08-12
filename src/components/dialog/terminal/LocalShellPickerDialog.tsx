import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { invoke } from "@/lib/invoke";

export interface LocalShellSelection {
  shellPath: string;
  shellArgs: string;
  name: string;
  kind: string;
  elevated: boolean;
}

export interface LocalShellOption {
  id: string;
  name: string;
  shellPath: string;
  shellArgs: string;
  kind: string;
  elevated: boolean;
}

interface LocalShellPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (shell: LocalShellSelection) => void;
}

function kindLabelKey(kind: string): string {
  switch (kind) {
    case "powershell":
      return "localShellPicker.kindPowerShell";
    case "pwsh":
      return "localShellPicker.kindPwsh";
    case "cmd":
      return "localShellPicker.kindCmd";
    case "git_bash":
      return "localShellPicker.kindGitBash";
    case "wsl":
      return "localShellPicker.kindWsl";
    case "bash":
      return "localShellPicker.kindBash";
    case "zsh":
      return "localShellPicker.kindZsh";
    case "fish":
      return "localShellPicker.kindFish";
    case "sh":
      return "localShellPicker.kindSh";
    default:
      return "localShellPicker.kindShell";
  }
}

export default function LocalShellPickerDialog({
  open,
  onClose,
  onSelect,
}: LocalShellPickerDialogProps) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const itemButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [shells, setShells] = useState<LocalShellOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadShells = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const options = await invoke<LocalShellOption[]>("list_local_shells");
      setShells(options);
    } catch (err) {
      setShells([]);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    void loadShells();
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [loadShells, open]);

  const filteredShells = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return shells;
    return shells.filter((shell) => {
      const haystack = [
        shell.name,
        shell.shellPath,
        shell.shellArgs,
        shell.kind,
        shell.elevated ? "admin administrator" : "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [query, shells]);

  const selectedShell = filteredShells[selectedIndex] ?? null;

  useEffect(() => {
    if (filteredShells.length === 0) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((index) => Math.min(index, filteredShells.length - 1));
  }, [filteredShells.length]);

  useEffect(() => {
    if (!open || !selectedShell) return;
    itemButtonRefs.current.get(selectedShell.id)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [open, selectedShell]);

  const selectShell = (shell: LocalShellOption) => {
    onSelect({
      shellPath: shell.shellPath,
      shellArgs: shell.shellArgs,
      name: shell.name,
      kind: shell.kind,
      elevated: shell.elevated,
    });
  };

  const displayName = (shell: LocalShellOption) =>
    shell.elevated ? `${shell.name} (${t("localShellPicker.admin")})` : shell.name;

  const handleCustomShell = async () => {
    const selected = await openFileDialog({
      multiple: false,
      directory: false,
      title: t("localShellPicker.selectShellFile"),
    });
    if (typeof selected !== "string" || !selected.trim()) return;
    const baseName = selected.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "") || selected;
    onSelect({
      shellPath: selected,
      shellArgs: "",
      name: baseName,
      kind: "custom",
      elevated: false,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="top-[18vh] w-[min(40rem,calc(100vw-2rem))] max-w-none translate-y-0 gap-0 overflow-hidden rounded-md p-0 shadow-2xl"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("localShellPicker.title")}</DialogTitle>
          <DialogDescription>{t("localShellPicker.searchPlaceholder")}</DialogDescription>
        </DialogHeader>

        <div className="relative border-b">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((index) =>
                  filteredShells.length === 0 ? 0 : (index + 1) % filteredShells.length,
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((index) =>
                  filteredShells.length === 0
                    ? 0
                    : (index - 1 + filteredShells.length) % filteredShells.length,
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (selectedShell) selectShell(selectedShell);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder={t("localShellPicker.searchPlaceholder")}
            className="h-11 rounded-none border-0 bg-transparent pl-10 pr-3 text-sm shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="max-h-[min(24rem,55vh)] overflow-y-auto">
          {filteredShells.map((shell, index) => {
            const selected = index === selectedIndex;
            const subtitle = [shell.shellPath, shell.shellArgs].filter(Boolean).join(" ");
            return (
              <button
                key={shell.id}
                ref={(element) => {
                  if (element) {
                    itemButtonRefs.current.set(shell.id, element);
                  } else {
                    itemButtonRefs.current.delete(shell.id);
                  }
                }}
                type="button"
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-xs ${
                  selected ? "bg-primary/15" : "hover:bg-accent/70"
                }`}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => selectShell(shell)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{displayName(shell)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
                </span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.625rem] text-muted-foreground">
                  {shell.elevated ? t("localShellPicker.admin") : t(kindLabelKey(shell.kind))}
                </span>
              </button>
            );
          })}

          {filteredShells.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {loading
                ? t("common.loading")
                : error
                  ? error
                  : shells.length === 0
                    ? t("localShellPicker.noShells")
                    : t("localShellPicker.noMatches")}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Enter {t("localShellPicker.open")} / Esc {t("localShellPicker.close")}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={handleCustomShell}
          >
            {t("localShellPicker.custom")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
