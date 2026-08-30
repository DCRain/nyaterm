import { List, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useApp } from "@/context/AppContext";
import {
  formatKeysForDisplay,
  keyEventToHotkeyString,
} from "@/lib/shortcutRegistry";
import {
  customShortcutFromConfig,
  isBuiltinRdpShortcut,
  resolveRdpSpecialShortcuts,
  type RdpSpecialShortcut,
} from "@/lib/rdpSpecialShortcuts";
import type { RdpInputEvent } from "@/lib/rdpInput";

interface RdpShortcutPopoverProps {
  onSendShortcut: (events: RdpInputEvent[]) => void;
}

function shortcutLabel(shortcut: RdpSpecialShortcut, t: (key: string) => string): string {
  return shortcut.labelKey ? t(shortcut.labelKey) : shortcut.label;
}

export function RdpShortcutPopover({ onSendShortcut }: RdpShortcutPopoverProps) {
  const { t } = useTranslation();
  const { appSettings, updateAppSettings } = useApp();
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [recordedCombo, setRecordedCombo] = useState<string | null>(null);

  const shortcuts = useMemo(
    () => resolveRdpSpecialShortcuts(appSettings.rdp?.special_shortcuts ?? []),
    [appSettings.rdp?.special_shortcuts],
  );

  const resetAddDialog = useCallback(() => {
    setLabel("");
    setRecordedCombo(null);
  }, []);

  useEffect(() => {
    if (!addOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecordedCombo(null);
        return;
      }
      const combo = keyEventToHotkeyString(event);
      if (combo) setRecordedCombo(combo);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [addOpen]);

  const handleAddShortcut = () => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel || !recordedCombo) return;
    const nextShortcut = customShortcutFromConfig({
      id: crypto.randomUUID(),
      label: trimmedLabel,
      combo: recordedCombo,
    });
    updateAppSettings({
      rdp: {
        ...appSettings.rdp,
        special_shortcuts: [
          ...(appSettings.rdp?.special_shortcuts ?? []),
          {
            id: nextShortcut.id,
            label: nextShortcut.label,
            combo: nextShortcut.combo,
          },
        ],
      },
    });
    setAddOpen(false);
    resetAddDialog();
  };

  const handleDeleteShortcut = (id: string) => {
    if (isBuiltinRdpShortcut(id)) return;
    updateAppSettings({
      rdp: {
        ...appSettings.rdp,
        special_shortcuts: (appSettings.rdp?.special_shortcuts ?? []).filter(
          (shortcut) => shortcut.id !== id,
        ),
      },
    });
  };

  const handleRestoreDefaults = () => {
    updateAppSettings({
      rdp: {
        ...appSettings.rdp,
        special_shortcuts: [],
      },
    });
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="h-6 w-6 shrink-0 text-white"
            title={t("remoteDesktop.shortcutListTitle")}
            aria-label={t("remoteDesktop.shortcutListTitle")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <List className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-80 p-0"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="border-b px-3 py-2 text-sm font-medium">
            {t("remoteDesktop.shortcutListTitle")}
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {shortcuts.map((shortcut) => (
              <div
                key={shortcut.id}
                className="flex items-center gap-1 rounded-sm hover:bg-accent/60"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1.5 text-left text-sm"
                  onClick={() => {
                    onSendShortcut(shortcut.events);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{shortcutLabel(shortcut, t)}</span>
                  <KbdGroup className="shrink-0">
                    {formatKeysForDisplay(shortcut.combo)
                      .split(" / ")
                      .map((part) => (
                        <Kbd key={part}>{part}</Kbd>
                      ))}
                  </KbdGroup>
                </button>
                {!shortcut.builtin ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="h-7 w-7 shrink-0 text-muted-foreground"
                    title={t("remoteDesktop.deleteShortcut")}
                    aria-label={t("remoteDesktop.deleteShortcut")}
                    onClick={() => handleDeleteShortcut(shortcut.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1 border-t p-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 flex-1 text-xs"
              onClick={() => {
                setAddOpen(true);
                resetAddDialog();
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t("remoteDesktop.addShortcut")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              title={t("remoteDesktop.restoreShortcuts")}
              aria-label={t("remoteDesktop.restoreShortcuts")}
              onClick={handleRestoreDefaults}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog
        open={addOpen}
        onOpenChange={(nextOpen) => {
          setAddOpen(nextOpen);
          if (!nextOpen) resetAddDialog();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("remoteDesktop.addShortcut")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("remoteDesktop.shortcutNamePlaceholder")}
            />
            <div className="rounded-md border px-3 py-2 text-sm">
              <div className="mb-1 text-xs text-muted-foreground">
                {t("remoteDesktop.shortcutComboHint")}
              </div>
              {recordedCombo ? (
                <KbdGroup>
                  {formatKeysForDisplay(recordedCombo)
                    .split(" / ")
                    .map((part) => (
                      <Kbd key={part}>{part}</Kbd>
                    ))}
                </KbdGroup>
              ) : (
                <span className="text-muted-foreground">{t("remoteDesktop.shortcutRecording")}</span>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={!label.trim() || !recordedCombo}
              onClick={handleAddShortcut}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default RdpShortcutPopover;
