import type { TFunction } from "i18next";
import { type ReactNode, useMemo } from "react";
import { MdAdd, MdBolt, MdHistory, MdListAlt, MdTerminal } from "react-icons/md";
import NyaTermLogo from "@/components/NyaTermLogo";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/AppContext";
import type { SavedConnection } from "@/types/global";
import AssetConnectionIcon from "./AssetConnectionIcon";
import { formatAssetAddress } from "./assetFormatters";

const WORKBENCH_RECENT_LIMIT = 5;

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
  onConnectConnection: (connection: SavedConnection) => Promise<void> | void;
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
  onConnectConnection,
}: WorkbenchViewProps) {
  const { appSettings, savedConnections } = useApp();

  const recentConnections = useMemo(() => {
    const byId = new Map(savedConnections.map((connection) => [connection.id, connection]));
    return (appSettings.ui.recent_connection_ids ?? [])
      .map((id) => byId.get(id))
      .filter((connection): connection is SavedConnection => !!connection)
      .slice(0, WORKBENCH_RECENT_LIMIT);
  }, [appSettings.ui.recent_connection_ids, savedConnections]);

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

  const addressLabels = {
    localMachine: t("assets.localMachine"),
    notApplicable: t("assets.notApplicable"),
  };

  return (
    <div
      className="terminal-scroll h-full min-h-0 overflow-y-auto"
      style={{
        backgroundColor: backgroundEnabled ? "var(--df-bg-terminal)" : undefined,
      }}
    >
      <div className="flex min-h-full items-center justify-center px-6 py-16">
        <div className="flex w-full max-w-[36rem] flex-col gap-7">
          <header className="flex flex-col items-center gap-2 text-center">
            <NyaTermLogo className="size-11 rounded-[0.85rem] shadow-sm" />
            <div className="space-y-1">
              <h1
                className="text-lg font-semibold tracking-tight"
                style={{ color: "var(--df-text)" }}
              >
                NyaTerm
              </h1>
              <p className="text-xs" style={{ color: "var(--df-text-muted)" }}>
                {t("app.workbenchSubtitle")}
              </p>
            </div>
          </header>

          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {quickActions.map((action) => (
              <QuickActionButton
                key={action.id}
                label={action.label}
                icon={action.icon}
                onClick={action.onClick}
              />
            ))}
          </section>

          <section
            className="overflow-hidden rounded-xl border"
            style={{
              borderColor: "color-mix(in srgb, var(--df-border) 85%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--df-bg-panel) 72%, transparent)",
            }}
          >
            <div
              className="flex items-center gap-2 border-b px-3.5 py-2.5"
              style={{ borderColor: "color-mix(in srgb, var(--df-border) 70%, transparent)" }}
            >
              <MdHistory className="size-4" style={{ color: "var(--df-primary)" }} aria-hidden />
              <h2
                className="text-xs font-semibold tracking-wide"
                style={{ color: "var(--df-text)" }}
              >
                {t("app.workbenchRecent")}
              </h2>
            </div>

            {recentConnections.length > 0 ? (
              <ul>
                {recentConnections.map((connection, index) => (
                  <li
                    key={connection.id}
                    className={index > 0 ? "border-t" : undefined}
                    style={{
                      borderColor: "color-mix(in srgb, var(--df-border) 55%, transparent)",
                    }}
                  >
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--df-bg-hover)_70%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--df-bg-hover)_70%,transparent)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--df-primary)]"
                      onClick={() => void onConnectConnection(connection)}
                    >
                      <AssetConnectionIcon connection={connection} />
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-sm font-medium"
                          style={{ color: "var(--df-text)" }}
                        >
                          {connection.name}
                        </span>
                        <span
                          className="mt-0.5 block truncate text-[0.6875rem]"
                          style={{ color: "var(--df-text-muted)" }}
                        >
                          {formatRecentConnectionMeta(connection, addressLabels)}
                        </span>
                      </span>
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide"
                        style={{
                          color: "var(--df-text-dimmed)",
                          backgroundColor:
                            "color-mix(in srgb, var(--df-bg-hover) 70%, transparent)",
                        }}
                      >
                        {connection.type.replace(/_/g, " ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p
                className="px-3.5 py-6 text-center text-xs"
                style={{ color: "var(--df-text-muted)" }}
              >
                {t("app.workbenchRecentEmpty")}
              </p>
            )}
          </section>

          <section className="space-y-2.5">
            <h2
              className="px-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]"
              style={{ color: "var(--df-text-dimmed)" }}
            >
              {t("app.workbenchShortcuts")}
            </h2>
            <div
              className="grid grid-cols-1 gap-1 overflow-hidden rounded-xl border p-1.5 sm:grid-cols-2"
              style={{
                borderColor: "color-mix(in srgb, var(--df-border) 75%, transparent)",
                backgroundColor: "color-mix(in srgb, var(--df-bg-panel) 55%, transparent)",
              }}
            >
              {emptyWorkspaceActions.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--df-bg-hover)_65%,transparent)] focus-visible:ring-1 focus-visible:ring-[var(--df-primary)]"
                  onClick={item.onClick}
                >
                  <span className="truncate text-sm" style={{ color: "var(--df-text)" }}>
                    {item.label}
                  </span>
                  <ShortcutKeys value={item.shortcut} />
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function formatRecentConnectionMeta(
  connection: SavedConnection,
  labels: { localMachine: string; notApplicable: string },
): string {
  if (connection.type === "ssh") {
    const host = connection.host?.trim() || labels.notApplicable;
    const user = connection.username?.trim();
    const port =
      connection.port && connection.port !== 22 ? `:${connection.port}` : "";
    return user ? `${user}@${host}${port}` : `${host}${port}`;
  }
  if (connection.type === "telnet") {
    const host = connection.host?.trim() || labels.notApplicable;
    const port = connection.port ? `:${connection.port}` : "";
    return `${host}${port}`;
  }
  return formatAssetAddress(connection, labels);
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
      className="h-auto min-h-[4.25rem] cursor-pointer flex-col items-center gap-2 rounded-xl px-3 py-3 text-xs font-medium shadow-none transition-[transform,background-color,border-color] duration-150 hover:-translate-y-px"
      style={{
        color: "var(--df-text)",
        borderColor: "color-mix(in srgb, var(--df-border) 88%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--df-bg-panel) 78%, transparent)",
      }}
      onClick={onClick}
    >
      <span
        className="flex size-8 items-center justify-center rounded-lg"
        style={{
          color: "var(--df-primary)",
          backgroundColor: "color-mix(in srgb, var(--df-primary) 12%, transparent)",
        }}
      >
        {icon}
      </span>
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
    <span
      className="shrink-0 text-[0.75rem] tabular-nums"
      style={{ color: "var(--df-text-muted)" }}
      aria-hidden="true"
    >
      {keys.join(" + ")}
    </span>
  );
}
