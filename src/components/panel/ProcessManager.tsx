import { Copy } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MdArrowDropDown,
  MdArrowDropUp,
  MdMoreVert,
  MdRefresh,
  MdSearch,
  MdTaskAlt,
} from "react-icons/md";
import { toast } from "sonner";
import PanelHeader from "@/components/layout/PanelHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApp } from "@/context/AppContext";
import { useVirtualList } from "@/hooks/useVirtualList";
import { getErrorMessage } from "@/lib/errors";
import { invoke } from "@/lib/invoke";
import { cn } from "@/lib/utils";
import type { RemoteProcess } from "@/types/global";

type ProcessSortKey = "command" | "cpu" | "memory" | "pid" | "user";
type SortDirection = "asc" | "desc";
type PendingSignal = { process: RemoteProcess; signal: string; destructive: boolean } | null;
type ProcessDisplayMode = "compact" | "medium" | "narrow" | "wide";

const MAX_CONSECUTIVE_FAILURES = 3;
const PROCESS_UNSUPPORTED_ERROR = "process listing is unsupported on this remote host";
const PROCESS_ROW_HEIGHT = 38;
const PROCESS_DETAILS_HEIGHT = 120;
const PROCESS_COMPACT_ROW_HEIGHT = 46;
const PROCESS_NARROW_DETAILS_HEIGHT = 132;
const PROCESS_COMPACT_DETAILS_HEIGHT = 132;

function getProcessDisplayMode(width: number): ProcessDisplayMode {
  if (width > 0 && width < 260) return "compact";
  if (width > 0 && width < 380) return "narrow";
  if (width > 0 && width < 540) return "medium";
  return "wide";
}

function getProcessTableColumns(mode: ProcessDisplayMode) {
  switch (mode) {
    case "narrow":
      return "grid-cols-[minmax(0,1fr)_minmax(3.4rem,0.58fr)_minmax(3.5rem,0.58fr)_1.5rem]";
    case "medium":
      return "grid-cols-[minmax(0,1.25fr)_minmax(3.4rem,0.62fr)_minmax(3.5rem,0.54fr)_minmax(3.7rem,0.54fr)_1.5rem]";
    default:
      return "grid-cols-[minmax(0,1.35fr)_minmax(3.4rem,0.62fr)_minmax(3.5rem,0.54fr)_minmax(3.7rem,0.54fr)_minmax(3.6rem,0.5fr)_1.5rem]";
  }
}

function getProcessDataColumns(mode: ProcessDisplayMode) {
  switch (mode) {
    case "narrow":
      return "grid-cols-[minmax(0,1fr)_minmax(3.4rem,0.58fr)_minmax(3.5rem,0.58fr)]";
    case "medium":
      return "grid-cols-[minmax(0,1.25fr)_minmax(3.4rem,0.62fr)_minmax(3.5rem,0.54fr)_minmax(3.7rem,0.54fr)]";
    default:
      return "grid-cols-[minmax(0,1.35fr)_minmax(3.4rem,0.62fr)_minmax(3.5rem,0.54fr)_minmax(3.7rem,0.54fr)_minmax(3.6rem,0.5fr)]";
  }
}

function getProcessDataSpan(mode: ProcessDisplayMode) {
  switch (mode) {
    case "narrow":
      return "col-span-3";
    case "medium":
      return "col-span-4";
    default:
      return "col-span-5";
  }
}

function getProcessRowHeight(mode: ProcessDisplayMode) {
  return mode === "compact" ? PROCESS_COMPACT_ROW_HEIGHT : PROCESS_ROW_HEIGHT;
}

function getProcessDetailsHeight(mode: ProcessDisplayMode) {
  if (mode === "compact") return PROCESS_COMPACT_DETAILS_HEIGHT;
  if (mode === "narrow") return PROCESS_NARROW_DETAILS_HEIGHT;
  return PROCESS_DETAILS_HEIGHT;
}

function formatKb(kb: number): string {
  if (kb <= 0) return "0 B";
  const bytes = kb * 1024;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / 1024 ** i;
  return `${val < 10 ? val.toFixed(1) : val.toFixed(0)} ${units[i]}`;
}

function processMatches(process: RemoteProcess, query: string) {
  if (!query) return true;
  const haystack =
    `${process.pid} ${process.ppid} ${process.user} ${process.state} ${process.command} ${process.command_line}`.toLowerCase();
  return haystack.includes(query);
}

function cpuTone(value: number) {
  if (value >= 80) return "text-red-400";
  if (value >= 50) return "text-amber-300";
  return "text-foreground";
}

function memoryTone(value: number) {
  if (value >= 80) return "text-red-400";
  if (value >= 50) return "text-amber-300";
  return "text-muted-foreground";
}

function stateTone(state: string) {
  const normalized = state.toUpperCase();
  if (normalized.startsWith("Z")) return "border-red-500/40 bg-red-500/10 text-red-300";
  if (normalized.startsWith("D")) return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return "border-border bg-background text-muted-foreground";
}

function isProcessUnsupportedError(message: string) {
  return message.toLowerCase().includes(PROCESS_UNSUPPORTED_ERROR);
}

interface ProcessManagerProps {
  activeSessionId: string | null;
}

export default function ProcessManager({ activeSessionId }: ProcessManagerProps) {
  const { t } = useTranslation();
  const { appSettings } = useApp();
  const [processes, setProcesses] = useState<RemoteProcess[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: ProcessSortKey; direction: SortDirection }>({
    key: "cpu",
    direction: "desc",
  });
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [pendingSignal, setPendingSignal] = useState<PendingSignal>(null);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [displayMode, setDisplayMode] = useState<ProcessDisplayMode>("wide");
  const panelBodyRef = useRef<HTMLDivElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchingRef = useRef(false);
  const failCountRef = useRef(0);

  const enabled = appSettings.ui.show_process_manager ?? false;
  const pollIntervalMs = Math.max(3, appSettings.ui.process_manager_interval ?? 5) * 1000;
  const isCompactMode = displayMode === "compact";

  useEffect(() => {
    const element = panelBodyRef.current;
    if (!element) return;

    const syncDisplayMode = () => {
      setDisplayMode(getProcessDisplayMode(element.clientWidth));
    };

    syncDisplayMode();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(syncDisplayMode);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fetchProcesses = useCallback(async (sessionId: string, manual = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (manual) setIsManualRefreshing(true);

    try {
      const data = await invoke<RemoteProcess[]>("get_remote_processes", { sessionId });
      setProcesses(data);
      setErrorMessage(null);
      failCountRef.current = 0;
    } catch (error) {
      const message = getErrorMessage(error);
      setErrorMessage(message);
      if (isProcessUnsupportedError(message)) {
        setProcesses(null);
        failCountRef.current = MAX_CONSECUTIVE_FAILURES;
        return;
      }

      failCountRef.current += 1;
      if (failCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
        setProcesses(null);
      }
    } finally {
      fetchingRef.current = false;
      if (manual) setIsManualRefreshing(false);
    }
  }, []);

  const refresh = useCallback(() => {
    if (!enabled || !activeSessionId) return;
    void fetchProcesses(activeSessionId, true);
  }, [activeSessionId, enabled, fetchProcesses]);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    if (!enabled || !activeSessionId) {
      setProcesses(null);
      setErrorMessage(null);
      failCountRef.current = 0;
      return;
    }

    fetchProcesses(activeSessionId);
    pollRef.current = setInterval(() => fetchProcesses(activeSessionId), pollIntervalMs);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [enabled, activeSessionId, pollIntervalMs, fetchProcesses]);

  const errorText = errorMessage
    ? isProcessUnsupportedError(errorMessage)
      ? t("processManager.unsupported")
      : t("processManager.errorWithDetail", { error: errorMessage })
    : t("processManager.error");

  const normalizedQuery = query.trim().toLowerCase();
  const visibleProcesses = useMemo(() => {
    const items = (processes ?? []).filter((process) => processMatches(process, normalizedQuery));
    return [...items].sort((left, right) => {
      const direction = sort.direction === "asc" ? 1 : -1;
      let result = 0;
      switch (sort.key) {
        case "command":
          result = left.command.localeCompare(right.command) || left.pid - right.pid;
          break;
        case "memory":
          result =
            left.memory_percent - right.memory_percent ||
            left.rss_kb - right.rss_kb ||
            left.pid - right.pid;
          break;
        case "pid":
          result = left.pid - right.pid;
          break;
        case "user":
          result = left.user.localeCompare(right.user) || left.pid - right.pid;
          break;
        case "cpu":
          result =
            left.cpu_percent - right.cpu_percent ||
            left.memory_percent - right.memory_percent ||
            left.pid - right.pid;
          break;
        default:
          result = 0;
      }
      return result * direction;
    });
  }, [normalizedQuery, processes, sort]);

  const selectedProcess = visibleProcesses.find((process) => process.pid === selectedPid) ?? null;
  const {
    containerRef: processListRef,
    visibleItems: virtualProcesses,
    paddingTop: processPaddingTop,
    paddingBottom: processPaddingBottom,
    onScroll: handleProcessListScroll,
  } = useVirtualList(visibleProcesses, {
    getItemHeight: (process) =>
      process.pid === selectedPid
        ? getProcessRowHeight(displayMode) + getProcessDetailsHeight(displayMode)
        : getProcessRowHeight(displayMode),
    itemHeight: getProcessRowHeight(displayMode),
    overscan: 8,
  });

  useEffect(() => {
    if (selectedPid != null && !selectedProcess) {
      setSelectedPid(null);
    }
  }, [selectedPid, selectedProcess]);

  const toggleSelectedPid = useCallback(
    (pid: number) => {
      setSelectedPid(selectedPid === pid ? null : pid);
    },
    [selectedPid],
  );

  useEffect(() => {
    setSort((current) => {
      if (displayMode !== "wide" && current.key === "user") {
        return { key: "cpu", direction: "desc" };
      }
      if ((displayMode === "compact" || displayMode === "narrow") && current.key === "memory") {
        return { key: "cpu", direction: "desc" };
      }
      return current;
    });
  }, [displayMode]);

  const signalProcess = useCallback(
    async (process: RemoteProcess, signal: string) => {
      if (!activeSessionId) return;
      try {
        await invoke("signal_remote_process", {
          sessionId: activeSessionId,
          pid: process.pid,
          signal,
        });
        toast.success(t("processManager.signalSuccess", { pid: process.pid, signal }));
        void fetchProcesses(activeSessionId, true);
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    },
    [activeSessionId, fetchProcesses, t],
  );

  const copyProcessText = useCallback(
    async (value: string, successMessage: string) => {
      try {
        await navigator.clipboard.writeText(value);
        toast.success(successMessage);
      } catch {
        toast.error(t("processManager.copyFailed"));
      }
    },
    [t],
  );

  const toggleSort = useCallback((key: ProcessSortKey) => {
    setSort((current) => {
      if (current.key === key) {
        return { key, direction: current.direction === "asc" ? "desc" : "asc" };
      }
      return {
        key,
        direction: key === "cpu" || key === "memory" ? "desc" : "asc",
      };
    });
  }, []);

  return (
    <div
      className="nyaterm-wallpaper-transparent-surface h-full flex flex-col"
      style={{ backgroundColor: "var(--df-bg-panel)" }}
    >
      <PanelHeader
        title={t("panel.processManager")}
        actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-40"
                onClick={refresh}
                disabled={!enabled || !activeSessionId || isManualRefreshing}
                aria-label={t("common.refresh")}
              >
                <MdRefresh className={`h-4 w-4 ${isManualRefreshing ? "animate-spin" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t("common.refresh")}</TooltipContent>
          </Tooltip>
        }
      />

      <div ref={panelBodyRef} className="flex-1 min-h-0 p-2.5">
        {!activeSessionId ? (
          <EmptyState icon={<MdTaskAlt />} text={t("processManager.noSession")} />
        ) : !enabled ? (
          <EmptyState icon={<MdTaskAlt />} text={t("processManager.disabled")} />
        ) : errorMessage && !processes ? (
          <EmptyState icon={<MdTaskAlt />} text={errorText} />
        ) : processes ? (
          <div className="flex h-full min-h-0 flex-col space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <MdSearch className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pl-7 text-xs"
                  value={query}
                  placeholder={t("processManager.search")}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div
                className="flex h-8 shrink-0 items-center gap-1 px-1.5 font-mono text-xs text-muted-foreground"
                title={t("processManager.total")}
              >
                <span className="hidden text-[0.625rem] uppercase min-[340px]:inline">
                  {t("processManager.total")}
                </span>
                <span className="font-semibold text-foreground">{processes.length}</span>
              </div>
            </div>

            <div
              className="min-h-0 flex-1 overflow-hidden rounded-lg border"
              style={{ borderColor: "var(--df-border)" }}
            >
              {!isCompactMode && (
                <ProcessTableHeader mode={displayMode} sort={sort} onToggleSort={toggleSort} />
              )}

              <div
                ref={processListRef}
                className={cn(
                  "min-h-0 overflow-y-auto overflow-x-hidden terminal-scroll",
                  isCompactMode ? "h-full" : "h-[calc(100%-2rem)]",
                )}
                onScroll={handleProcessListScroll}
              >
                <div style={{ paddingTop: processPaddingTop, paddingBottom: processPaddingBottom }}>
                  {virtualProcesses.map(({ item: process }) => (
                    <div
                      key={process.pid}
                      className={cn(
                        "border-b border-l-2 border-l-transparent text-xs transition-colors hover:bg-muted/30",
                        process.pid === selectedProcess?.pid && "bg-muted/40",
                      )}
                      style={{ borderBottomColor: "var(--df-border)" }}
                    >
                      {isCompactMode ? (
                        <CompactProcessRow
                          process={process}
                          onSelect={() => toggleSelectedPid(process.pid)}
                          onSignal={(signal, destructive) => {
                            if (destructive) {
                              setPendingSignal({ process, signal, destructive });
                            } else {
                              void signalProcess(process, signal);
                            }
                          }}
                          onCopyCommand={() =>
                            void copyProcessText(
                              process.command_line || process.command,
                              t("processManager.commandCopied"),
                            )
                          }
                          onCopyPid={() =>
                            void copyProcessText(
                              String(process.pid),
                              t("processManager.pidCopied", { pid: process.pid }),
                            )
                          }
                        />
                      ) : (
                        <ProcessTableRow
                          mode={displayMode}
                          process={process}
                          onSelect={() => toggleSelectedPid(process.pid)}
                          onSignal={(signal, destructive) => {
                            if (destructive) {
                              setPendingSignal({ process, signal, destructive });
                            } else {
                              void signalProcess(process, signal);
                            }
                          }}
                          onCopyCommand={() =>
                            void copyProcessText(
                              process.command_line || process.command,
                              t("processManager.commandCopied"),
                            )
                          }
                          onCopyPid={() =>
                            void copyProcessText(
                              String(process.pid),
                              t("processManager.pidCopied", { pid: process.pid }),
                            )
                          }
                        />
                      )}
                      {process.pid === selectedProcess?.pid && (
                        <ProcessDetails
                          mode={displayMode}
                          process={process}
                          onCopyCommand={() =>
                            void copyProcessText(
                              process.command_line || process.command,
                              t("processManager.commandCopied"),
                            )
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
                {visibleProcesses.length === 0 && (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    {t("processManager.noMatches")}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <LoadingSpinner label={t("common.loading")} />
        )}
      </div>

      <AlertDialog
        open={Boolean(pendingSignal)}
        onOpenChange={(open) => !open && setPendingSignal(null)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("processManager.confirmSignalTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingSignal
                ? t("processManager.confirmSignalDesc", {
                    signal: pendingSignal.signal,
                    pid: pendingSignal.process.pid,
                    command: `kill -${pendingSignal.signal} -- ${pendingSignal.process.pid}`,
                  })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingSignal) void signalProcess(pendingSignal.process, pendingSignal.signal);
                setPendingSignal(null);
              }}
            >
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProcessActionMenu({
  onCopyCommand,
  onCopyPid,
  onSignal,
}: {
  onCopyCommand: () => void;
  onCopyPid: () => void;
  onSignal: (signal: string, destructive: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(event) => event.stopPropagation()}
        >
          <MdMoreVert className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onSelect={onCopyPid}>
          <Copy className="h-3.5 w-3.5" />
          {t("processManager.copyPid")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCopyCommand}>
          <Copy className="h-3.5 w-3.5" />
          {t("processManager.copyCommand")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onSignal("TERM", false)}>
          {t("processManager.signalTerm")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSignal("HUP", false)}>
          {t("processManager.signalHup")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSignal("STOP", false)}>
          {t("processManager.signalStop")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSignal("CONT", false)}>
          {t("processManager.signalCont")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onSignal("KILL", true)}>
          {t("processManager.signalKill")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProcessTableHeader({
  mode,
  sort,
  onToggleSort,
}: {
  mode: ProcessDisplayMode;
  sort: { key: ProcessSortKey; direction: SortDirection };
  onToggleSort: (key: ProcessSortKey) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "grid h-8 items-center gap-1 border-b px-2 font-mono text-[0.625rem] font-semibold uppercase text-muted-foreground",
        getProcessTableColumns(mode),
      )}
      style={{ borderColor: "var(--df-border)" }}
    >
      <ProcessColumnHeader
        active={sort.key === "command"}
        direction={sort.direction}
        label={t("processManager.process")}
        onClick={() => onToggleSort("command")}
      />
      <ProcessColumnHeader
        active={sort.key === "pid"}
        direction={sort.direction}
        label="PID"
        numeric
        onClick={() => onToggleSort("pid")}
      />
      <ProcessColumnHeader
        active={sort.key === "cpu"}
        direction={sort.direction}
        label="CPU"
        numeric
        onClick={() => onToggleSort("cpu")}
      />
      {mode !== "narrow" && (
        <ProcessColumnHeader
          active={sort.key === "memory"}
          direction={sort.direction}
          label="MEM"
          numeric
          onClick={() => onToggleSort("memory")}
        />
      )}
      {mode === "wide" && (
        <ProcessColumnHeader
          active={sort.key === "user"}
          direction={sort.direction}
          label={t("processManager.user")}
          onClick={() => onToggleSort("user")}
        />
      )}
      <span />
    </div>
  );
}

function ProcessTableRow({
  mode,
  process,
  onSelect,
  onSignal,
  onCopyCommand,
  onCopyPid,
}: {
  mode: ProcessDisplayMode;
  process: RemoteProcess;
  onSelect: () => void;
  onSignal: (signal: string, destructive: boolean) => void;
  onCopyCommand: () => void;
  onCopyPid: () => void;
}) {
  return (
    <div className={cn("grid h-[38px] items-center gap-1 px-2", getProcessTableColumns(mode))}>
      <button
        type="button"
        className={cn(
          "grid h-full min-w-0 cursor-pointer items-center gap-1 text-left",
          getProcessDataSpan(mode),
          getProcessDataColumns(mode),
        )}
        onClick={onSelect}
      >
        <span className="truncate font-medium" title={process.command_line}>
          {process.command}
        </span>
        <span className="truncate text-right font-mono text-muted-foreground">{process.pid}</span>
        <span className={cn("truncate text-right font-mono", cpuTone(process.cpu_percent))}>
          {process.cpu_percent.toFixed(1)}%
        </span>
        {mode !== "narrow" && (
          <span className={cn("truncate text-right font-mono", memoryTone(process.memory_percent))}>
            {process.memory_percent.toFixed(1)}%
          </span>
        )}
        {mode === "wide" && (
          <span className="truncate font-mono text-muted-foreground" title={process.user}>
            {process.user}
          </span>
        )}
      </button>
      <div className="flex justify-end">
        <ProcessActionMenu
          onCopyCommand={onCopyCommand}
          onCopyPid={onCopyPid}
          onSignal={onSignal}
        />
      </div>
    </div>
  );
}

function CompactProcessRow({
  process,
  onSelect,
  onSignal,
  onCopyCommand,
  onCopyPid,
}: {
  process: RemoteProcess;
  onSelect: () => void;
  onSignal: (signal: string, destructive: boolean) => void;
  onCopyCommand: () => void;
  onCopyPid: () => void;
}) {
  return (
    <div className="flex h-[46px] items-center gap-2 px-2">
      <button
        type="button"
        className="grid h-full min-w-0 flex-1 cursor-pointer grid-cols-[minmax(0,1fr)_4rem] items-center gap-2 text-left"
        onClick={onSelect}
      >
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium" title={process.command_line}>
            {process.command}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[0.6875rem] text-muted-foreground">
            PID {process.pid}
          </span>
        </span>
        <span className={cn("truncate text-right font-mono text-xs font-semibold", cpuTone(process.cpu_percent))}>
          {process.cpu_percent.toFixed(1)}%
        </span>
      </button>
      <div className="flex w-6 shrink-0 justify-end">
        <ProcessActionMenu
          onCopyCommand={onCopyCommand}
          onCopyPid={onCopyPid}
          onSignal={onSignal}
        />
      </div>
    </div>
  );
}

function ProcessColumnHeader({
  active,
  direction,
  label,
  numeric = false,
  onClick,
}: {
  active: boolean;
  direction: SortDirection;
  label: string;
  numeric?: boolean;
  onClick: () => void;
}) {
  const Icon = direction === "asc" ? MdArrowDropUp : MdArrowDropDown;
  return (
    <button
      type="button"
      className={cn(
        "flex min-w-0 items-center gap-0.5 truncate transition-colors hover:text-foreground",
        numeric && "justify-end text-right",
        active ? "text-foreground" : "text-muted-foreground",
      )}
      onClick={onClick}
    >
      <span className="truncate">{label}</span>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", !active && "opacity-0")} />
    </button>
  );
}

function ProcessDetails({
  mode,
  process,
  onCopyCommand,
}: {
  mode: ProcessDisplayMode;
  process: RemoteProcess;
  onCopyCommand: () => void;
}) {
  const { t } = useTranslation();
  const compact = mode === "compact";
  const narrow = compact || mode === "narrow";
  const detailHeight = compact ? "h-[132px]" : narrow ? "h-[132px]" : "h-[120px]";

  return (
    <div
      className={cn("overflow-hidden border-t px-2 py-2", detailHeight)}
      style={{ backgroundColor: "var(--df-bg)", borderTopColor: "var(--df-border)" }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.6875rem] text-muted-foreground">
        <span>PPID {process.ppid}</span>
        <span className="truncate">{process.user}</span>
        <Badge className={cn("h-5 shrink-0 px-1.5 font-mono text-[0.625rem]", stateTone(process.state))} variant="outline">
          {process.state}
        </Badge>
      </div>

      <div className={cn("mt-2 grid gap-x-4 gap-y-1", narrow ? "grid-cols-2" : "grid-cols-4")}>
        <Metric label="CPU" value={`${process.cpu_percent.toFixed(1)}%`} valueClassName={cpuTone(process.cpu_percent)} />
        <Metric
          label="MEM"
          value={`${process.memory_percent.toFixed(1)}%`}
          valueClassName={memoryTone(process.memory_percent)}
        />
        <Metric label="RSS" value={formatKb(process.rss_kb)} />
        <Metric label={t("processManager.elapsed")} value={process.elapsed} />
      </div>

      <div
        className={cn(
          "relative mt-2 overflow-y-auto break-all rounded-md bg-muted/30 py-1 pr-8 pl-2 font-mono text-[0.6875rem] text-muted-foreground terminal-scroll",
          compact ? "max-h-12" : narrow ? "max-h-10" : "max-h-8",
        )}
      >
        {process.command_line || process.command}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute top-1 right-1 h-5 w-5 text-muted-foreground hover:text-foreground"
              onClick={onCopyCommand}
              aria-label={t("processManager.copyCommand")}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{t("processManager.copyCommand")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2">
      <span className="truncate text-[0.625rem] uppercase text-muted-foreground">{label}</span>
      <span className={cn("truncate text-right font-mono text-xs font-semibold", valueClassName)}>
        {value}
      </span>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <span className="text-2xl" style={{ color: "var(--df-text-dimmed)" }}>
        {icon}
      </span>
      <span className="text-sm" style={{ color: "var(--df-text-muted)" }}>
        {text}
      </span>
    </div>
  );
}

function LoadingSpinner({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <svg
        className="h-5 w-5 animate-spin"
        style={{ color: "var(--df-text-dimmed)" }}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <title>{label}</title>
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
    </div>
  );
}
