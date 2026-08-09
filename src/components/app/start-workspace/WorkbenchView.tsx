import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { MdAdd, MdBolt, MdListAlt, MdTerminal } from "react-icons/md";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

interface WorkbenchViewProps {
  t: TFunction;
  backgroundEnabled: boolean;
  temporarySshShortcut: string;
  openChatShortcut: string;
  showCommandsShortcut: string;
  switchTerminalShortcut: string;
  onNewConnection: () => void;
  onNewLocalTerminal: () => void;
  onQuickOpenConnection: () => void;
  onTemporarySshLink: () => void;
  onOpenChat: () => void;
  onShowCommands: () => void;
  onSwitchTerminal: () => void;
}

export default function WorkbenchView({
  t,
  backgroundEnabled,
  temporarySshShortcut,
  openChatShortcut,
  showCommandsShortcut,
  switchTerminalShortcut,
  onNewConnection,
  onNewLocalTerminal,
  onQuickOpenConnection,
  onTemporarySshLink,
  onOpenChat,
  onShowCommands,
  onSwitchTerminal,
}: WorkbenchViewProps) {
  const quickActions = [
    {
      id: "new-connection",
      label: t("app.workbenchNewConnection"),
      icon: <MdAdd className="text-lg" />,
      onClick: onNewConnection,
    },
    {
      id: "local-terminal",
      label: t("app.workbenchLocalTerminal"),
      icon: <MdTerminal className="text-lg" />,
      onClick: onNewLocalTerminal,
    },
    {
      id: "quick-open",
      label: t("app.workbenchQuickOpen"),
      icon: <MdListAlt className="text-lg" />,
      onClick: onQuickOpenConnection,
    },
    {
      id: "temporary-link",
      label: t("app.workbenchTemporaryLink"),
      icon: <MdBolt className="text-lg" />,
      onClick: onTemporarySshLink,
    },
  ];

  const emptyWorkspaceActions = [
    {
      label: t("temporarySsh.title"),
      shortcut: temporarySshShortcut,
      onClick: onTemporarySshLink,
    },
    {
      label: t("app.openChat"),
      shortcut: openChatShortcut,
      onClick: onOpenChat,
    },
    {
      label: t("app.showAllCommands"),
      shortcut: showCommandsShortcut,
      onClick: onShowCommands,
    },
    {
      label: t("app.switchTerminal"),
      shortcut: switchTerminalShortcut,
      onClick: onSwitchTerminal,
    },
  ];

  return (
    <div
      className="flex h-full items-center justify-center px-6"
      style={{
        backgroundColor: backgroundEnabled ? "var(--df-bg-terminal)" : undefined,
      }}
    >
      <div className="flex w-full max-w-[34rem] flex-col items-center gap-8">
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
          {quickActions.map((action) => (
            <QuickActionButton
              key={action.id}
              label={action.label}
              icon={action.icon}
              onClick={action.onClick}
            />
          ))}
        </div>

        <div className="grid w-fit max-w-[30rem] grid-cols-[max-content_auto] gap-x-4 gap-y-3 text-sm">
          {emptyWorkspaceActions.map((item) => (
            <button
              key={item.label}
              type="button"
              className="contents text-left"
              onClick={item.onClick}
            >
              <span
                className="justify-self-start transition-colors hover:text-[var(--df-primary)]"
                style={{ color: "var(--df-primary)" }}
              >
                {item.label}
              </span>
              <ShortcutKeys value={item.shortcut} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuickActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-auto flex-col items-center gap-2 px-3 py-3 text-xs font-medium"
      style={{
        color: "var(--df-text)",
        borderColor: "var(--df-border)",
        backgroundColor: "color-mix(in srgb, var(--df-bg-panel) 70%, transparent)",
      }}
      onClick={onClick}
    >
      <span style={{ color: "var(--df-primary)" }}>{icon}</span>
      <span className="truncate">{label}</span>
    </Button>
  );
}

function ShortcutKeys({ value }: { value: string }) {
  const keys = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!keys.length) return null;

  return (
    <KbdGroup className="justify-self-end text-[0.8125rem]" aria-hidden="true">
      {keys.map((key, index) => (
        <span key={key} className="inline-flex items-center gap-1">
          {index > 0 ? <span style={{ color: "var(--df-text-dimmed)" }}>+</span> : null}
          <Kbd className="h-6 min-w-7 border border-[var(--df-border)] bg-[var(--df-bg-hover)] px-1.5 text-[0.8125rem] text-[var(--df-text)] shadow-sm">
            {key}
          </Kbd>
        </span>
      ))}
    </KbdGroup>
  );
}
