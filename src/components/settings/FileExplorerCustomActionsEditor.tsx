import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdAdd, MdDelete, MdEdit } from "react-icons/md";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createFileExplorerCustomAction,
  normalizeFileExplorerConfirmationLevel,
} from "@/lib/fileExplorerActions";
import type { FileExplorerCustomAction } from "@/types/global";
import {
  SettingNumberInput,
  SettingRow,
  SettingSection,
  SettingSelect,
  SettingSwitch,
} from "./SettingFormItems";

const MB = 1024 * 1024;

function bytesToMb(bytes: number | undefined): number {
  if (!bytes || bytes <= 0) return 0;
  return Math.max(0, Math.round(bytes / MB));
}

function mbToBytes(mb: number): number {
  if (!Number.isFinite(mb) || mb <= 0) return 0;
  return Math.round(mb) * MB;
}

function DeleteIconButton({ onDelete, title }: { onDelete: () => void; title: string }) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      title={title}
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      onClick={onDelete}
    >
      <MdDelete className="text-[0.95rem]" />
    </Button>
  );
}

function normalizeTarget(target: string): FileExplorerCustomAction["target"] {
  return target === "directory" ? "directory" : "file";
}

function ActionEditorDialog({
  open,
  mode,
  draft,
  onOpenChange,
  onChange,
  onSave,
}: {
  open: boolean;
  mode: "add" | "edit";
  draft: FileExplorerCustomAction | null;
  onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<FileExplorerCustomAction>) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  if (!draft) return null;

  const target = normalizeTarget(draft.target);
  const canSave =
    draft.name.trim().length > 0 &&
    draft.command.trim().length > 0 &&
    (target === "directory" || draft.match_pattern.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(32rem,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-sm">
            {mode === "edit"
              ? t("settings.fileExplorerCustomActionEditTitle")
              : t("settings.fileExplorerCustomActionAddTitle")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("settings.fileExplorerCustomActionsDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-4 py-4">
          <Input
            value={draft.name}
            className="text-sm"
            placeholder={t("settings.fileExplorerCustomActionName")}
            onChange={(event) => onChange({ name: event.target.value })}
            autoFocus
          />
          <SettingSelect
            label={t("settings.fileExplorerCustomActionTarget")}
            value={target}
            controlClassName="max-w-sm"
            onValueChange={(value) => {
              const nextTarget = normalizeTarget(value);
              onChange({
                target: nextTarget,
                ...(nextTarget === "directory"
                  ? { match_pattern: "", max_file_size_bytes: 0 }
                  : {}),
              });
            }}
          >
            <SelectItem value="file">{t("settings.fileExplorerCustomActionTargetFile")}</SelectItem>
            <SelectItem value="directory">
              {t("settings.fileExplorerCustomActionTargetDirectory")}
            </SelectItem>
          </SettingSelect>
          {target === "file" ? (
            <>
              <Input
                value={draft.match_pattern}
                className="font-mono text-sm"
                placeholder={t("settings.fileExplorerCustomActionPatternPlaceholder")}
                onChange={(event) => onChange({ match_pattern: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.fileExplorerCustomActionPatternDesc")}
              </p>
              <SettingNumberInput
                label={t("settings.fileExplorerCustomActionMaxSize")}
                desc={t("settings.fileExplorerCustomActionMaxSizeDesc")}
                min={0}
                max={10240}
                step={1}
                value={bytesToMb(draft.max_file_size_bytes)}
                onChange={(value) => onChange({ max_file_size_bytes: mbToBytes(value) })}
              />
            </>
          ) : null}
          <Textarea
            value={draft.command}
            className="min-h-24 resize-y font-mono text-sm"
            placeholder={t("settings.fileExplorerCustomActionCommandPlaceholder")}
            onChange={(event) => onChange({ command: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {t("settings.fileExplorerCustomActionCommandDesc")}
          </p>
          <SettingRow
            label={t("settings.fileExplorerCustomActionExecute")}
            desc={t("settings.fileExplorerCustomActionExecuteDesc")}
          >
            <SettingSwitch checked={draft.execute} onChange={(execute) => onChange({ execute })} />
          </SettingRow>
          <SettingSelect
            label={t("settings.fileExplorerCustomActionConfirmationLevel")}
            desc={t("settings.fileExplorerCustomActionConfirmationLevelDesc")}
            value={normalizeFileExplorerConfirmationLevel(draft.confirmation_level)}
            controlClassName="max-w-sm"
            onValueChange={(value) =>
              onChange({ confirmation_level: normalizeFileExplorerConfirmationLevel(value) })
            }
          >
            <SelectItem value="none">
              {t("settings.fileExplorerCustomActionConfirmationLevelNone")}
            </SelectItem>
            <SelectItem value="warning">
              {t("settings.fileExplorerCustomActionConfirmationLevelWarning")}
            </SelectItem>
            <SelectItem value="danger">
              {t("settings.fileExplorerCustomActionConfirmationLevelDanger")}
            </SelectItem>
          </SettingSelect>
        </div>
        <DialogFooter className="border-t px-4 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("dialog.cancel")}
          </Button>
          <Button size="sm" onClick={onSave} disabled={!canSave}>
            {t("dialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FileExplorerCustomActionsEditor({
  actions,
  onChange,
}: {
  actions: FileExplorerCustomAction[];
  onChange: (actions: FileExplorerCustomAction[]) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<FileExplorerCustomAction | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!draft) setEditingId(null);
  }, [draft]);

  const openCreate = () => {
    const next = createFileExplorerCustomAction({ name: "" });
    setEditingId(null);
    setDraft(next);
  };

  const openEdit = (action: FileExplorerCustomAction) => {
    setEditingId(action.id);
    setDraft({ ...action, target: normalizeTarget(action.target) });
  };

  const saveDraft = () => {
    if (!draft) return;
    const next: FileExplorerCustomAction = {
      ...draft,
      target: normalizeTarget(draft.target),
      name: draft.name.trim(),
      command: draft.command.trim(),
      match_pattern:
        normalizeTarget(draft.target) === "directory" ? "" : draft.match_pattern.trim(),
      max_file_size_bytes:
        normalizeTarget(draft.target) === "directory"
          ? 0
          : Math.max(0, draft.max_file_size_bytes ?? 0),
      confirmation_level: normalizeFileExplorerConfirmationLevel(draft.confirmation_level),
    };
    if (!next.name || !next.command) return;
    if (normalizeTarget(next.target) === "file" && !next.match_pattern) return;

    if (editingId) {
      onChange(actions.map((action) => (action.id === editingId ? next : action)));
    } else {
      onChange([...actions, next]);
    }
    setDraft(null);
    setEditingId(null);
  };

  return (
    <>
      <SettingSection
        title={t("settings.fileExplorerCustomActions")}
        desc={t("settings.fileExplorerCustomActionsDesc")}
        action={
          <Button size="sm" variant="outline" onClick={openCreate}>
            <MdAdd />
            {t("common.add")}
          </Button>
        }
        contentClassName="space-y-2"
      >
        {actions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("settings.fileExplorerCustomActionsEmpty")}
          </p>
        ) : (
          <div className="divide-y divide-border/60 overflow-hidden rounded-md border border-border/70">
            {actions.map((action) => {
              const target = normalizeTarget(action.target);
              const summary =
                target === "directory"
                  ? t("settings.fileExplorerCustomActionTargetDirectory")
                  : action.match_pattern.trim() ||
                    t("settings.fileExplorerCustomActionPatternPlaceholder");
              const confirmationLevel = normalizeFileExplorerConfirmationLevel(
                action.confirmation_level,
              );
              return (
                <div
                  key={action.id}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-sm font-medium">
                        {action.name.trim() || t("settings.fileExplorerCustomActionUntitled")}
                      </div>
                      {confirmationLevel === "warning" ? (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                          {t("settings.fileExplorerCustomActionConfirmationBadgeWarning")}
                        </span>
                      ) : null}
                      {confirmationLevel === "danger" ? (
                        <span className="shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
                          {t("settings.fileExplorerCustomActionConfirmationBadgeDanger")}
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {summary}
                      {action.command.trim() ? ` · ${action.command.trim()}` : ""}
                    </div>
                  </div>
                  <SettingSwitch
                    checked={action.enabled}
                    onChange={(enabled) =>
                      onChange(
                        actions.map((item) =>
                          item.id === action.id ? { ...item, enabled } : item,
                        ),
                      )
                    }
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title={t("common.edit")}
                    aria-label={t("common.edit")}
                    onClick={() => openEdit(action)}
                  >
                    <MdEdit className="text-[0.95rem]" />
                  </Button>
                  <DeleteIconButton
                    title={t("common.delete")}
                    onDelete={() => onChange(actions.filter((item) => item.id !== action.id))}
                  />
                </div>
              );
            })}
          </div>
        )}
      </SettingSection>

      <ActionEditorDialog
        open={Boolean(draft)}
        mode={editingId ? "edit" : "add"}
        draft={draft}
        onOpenChange={(open) => {
          if (!open) {
            setDraft(null);
            setEditingId(null);
          }
        }}
        onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
        onSave={saveDraft}
      />
    </>
  );
}
