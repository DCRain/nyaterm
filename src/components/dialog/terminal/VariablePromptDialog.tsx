import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface VariableDef {
  key: string;
  raw: string;
  raws: string[];
  name: string;
  options?: string[];
  defaultValue?: string;
}

interface VariablePromptDialogProps {
  open: boolean;
  command: string;
  variables: VariableDef[];
  onCancel: () => void;
  onSubmit: (resolvedCommand: string) => void;
}

export default function VariablePromptDialog({
  open,
  command,
  variables,
  onCancel,
  onSubmit,
}: VariablePromptDialogProps) {
  const { t } = useTranslation();

  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      const initial: Record<string, string> = {};

      variables.forEach((v) => {
        initial[v.key] = v.defaultValue || (v.options && v.options.length > 0 ? v.options[0] : "");
      });
      setValues(initial);
    }
  }, [open, variables]);

  const handleSubmit = () => {
    onSubmit(resolveCommandVariables(command, variables, values));
  };

  return (
    <Dialog disablePointerDismissal open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="w-[min(400px,calc(100vw-2rem))] sm:max-w-[400px] p-0 gap-0">
        <DialogHeader className="px-5 py-3 border-b">
          <DialogTitle className="text-sm">{t("quickCommands.fillVariables")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("quickCommands.fillVariables")}
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {variables.map((v, index) => (
            <div key={v.key}>
              <Label className="text-[0.6875rem] text-muted-foreground">{v.name}</Label>
              {v.options && v.options.length > 0 ? (
                <Select
                  value={values[v.key] || ""}
                  onValueChange={(val) => setValues({ ...values, [v.key]: val })}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {v.options.map((opt) => (
                      <SelectItem key={opt} value={opt} className="text-xs">
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="mt-1 text-xs h-8"
                  value={values[v.key] || ""}
                  onChange={(e) => setValues({ ...values, [v.key]: e.target.value })}
                  autoFocus={index === 0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSubmit();
                    }
                  }}
                />
              )}
            </div>
          ))}

          <div className="bg-muted/50 p-2 rounded relative mt-4">
            <Label className="text-[0.625rem] text-muted-foreground absolute -top-2 left-2 px-1 bg-popover">
              Preview
            </Label>
            <div className="text-[0.6875rem] font-mono break-all text-muted-foreground mt-2">
              {(() => {
                const preview = resolveCommandVariables(command, variables, values);
                return preview || <span className="opacity-50">Empty command</span>;
              })()}
            </div>
          </div>
        </div>

        <DialogFooter className="px-5 py-3 border-t">
          <Button variant="ghost" size="sm" className="text-xs" onClick={onCancel}>
            {t("dialog.cancel")}
          </Button>
          <Button size="sm" className="text-xs" onClick={handleSubmit}>
            {t("quickCommands.run")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function parseVariableContent(content: string) {
  const optionDelimiter = content.indexOf("|");
  if (optionDelimiter >= 0) {
    const name = content.slice(0, optionDelimiter).trim();
    const options = content
      .slice(optionDelimiter + 1)
      .split(",")
      .map((s) => s.trim());
    return { name, options };
  }

  const defaultDelimiter = content.indexOf("=");
  if (defaultDelimiter >= 0) {
    const name = content.slice(0, defaultDelimiter).trim();
    const defaultValue = content.slice(defaultDelimiter + 1).trim();
    return { name, defaultValue };
  }

  return { name: content.trim() };
}

export function parseCommandVariables(command: string): VariableDef[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const matches = [...command.matchAll(regex)];

  const vars: VariableDef[] = [];
  const byName = new Map<string, VariableDef>();

  for (const match of matches) {
    const raw = match[0];
    const variable = parseVariableContent(match[1]);
    if (!variable.name) continue;

    const existing = byName.get(variable.name);
    if (existing) {
      if (!existing.raws.includes(raw)) {
        existing.raws.push(raw);
      }
      if (!existing.options && variable.options) {
        existing.options = variable.options;
      }
      if (existing.defaultValue === undefined && variable.defaultValue !== undefined) {
        existing.defaultValue = variable.defaultValue;
      }
      continue;
    }

    const parsedVariable: VariableDef = {
      key: `variable-${vars.length}`,
      raw,
      raws: [raw],
      name: variable.name,
      options: variable.options,
      defaultValue: variable.defaultValue,
    };
    vars.push(parsedVariable);
    byName.set(variable.name, parsedVariable);
  }

  return vars;
}

export function resolveCommandVariables(
  command: string,
  variables: VariableDef[],
  values: Record<string, string>,
) {
  let finalCmd = command;
  variables.forEach((variable) => {
    const value = values[variable.key] || "";
    const raws = variable.raws.length > 0 ? variable.raws : [variable.raw];
    raws.forEach((raw) => {
      finalCmd = finalCmd.split(raw).join(value);
    });
  });
  return finalCmd;
}
