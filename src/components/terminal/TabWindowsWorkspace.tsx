import {
  type DragEvent,
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ComponentProps } from "react";
import ResizeHandle from "@/components/layout/ResizeHandle";
import type StartWorkspace from "@/components/app/start-workspace/StartWorkspace";
import {
  isTerminalWindowSplit,
  type SplitEdgeDirection,
  type TerminalWindowLeaf,
  type TerminalWindowNode,
  type TerminalWindowSplit,
} from "@/lib/tabWindows";
import type {
  RecordingMode,
  RecordingStatus,
  Tab,
} from "@/types/global";
import PaneWorkspace from "./PaneWorkspace";
import DropZoneOverlay, { type DropZone } from "./TabDockDropOverlay";

type WorkbenchRenderProps = ComponentProps<typeof StartWorkspace>;

interface LeafContentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface TabPlacement {
  tab: Tab;
  leafId: string;
  active: boolean;
}

interface DropState {
  leafId: string;
  zone: DropZone;
}

interface TabWindowsWorkspaceProps {
  layout: TerminalWindowNode | null;
  tabsById: Map<string, Tab>;
  onSelectTab: (leafId: string, tabId: string) => void;
  onMoveTabToLeaf?: (fromTabId: string, targetLeafId: string, toIndex: number) => void;
  onSplitTabToLeaf?: (
    fromTabId: string,
    targetLeafId: string,
    direction: SplitEdgeDirection,
  ) => void;
  onActivatePane: (tabId: string, paneId: string) => void;
  onUpdatePaneSplitRatio: (tabId: string, splitId: string, ratio: number) => void;
  onUpdateWindowSplitRatio: (splitId: string, ratio: number) => void;
  onReconnectPane?: (tabId: string, paneId: string) => void | Promise<void>;
  onReconnected?: (oldSessionId: string, newSessionId: string) => void;
  onDisconnectedCloseRequested?: (tabId: string, paneId: string) => void | Promise<void>;
  onConnectionError?: (tabId: string, paneId: string, sessionId: string, error: string) => void;
  recordingStatuses?: RecordingStatus[];
  onToggleSessionRecording?: (sessionId: string, mode?: RecordingMode) => Promise<void> | void;
  onSaveSessionTranscript?: (sessionId: string, sessionName?: string) => Promise<void> | void;
  workbench?: WorkbenchRenderProps;
}

type LeafContentRectChange = (leafId: string, rect: LeafContentRect | null) => void;
type LeafDragHandler = (leafId: string, event: DragEvent<HTMLDivElement>) => void;

interface WindowNodeViewExtraProps {
  workspaceRef: RefObject<HTMLDivElement | null>;
  dropState: DropState | null;
  onLeafContentRectChange: LeafContentRectChange;
  onLeafDragOver: LeafDragHandler;
  onLeafDragLeave: LeafDragHandler;
  onLeafDrop: LeafDragHandler;
}

type WindowNodeViewProps = Pick<
  TabWindowsWorkspaceProps,
  "tabsById" | "onSelectTab" | "onUpdateWindowSplitRatio"
> &
  WindowNodeViewExtraProps;

function areRectsEqual(left: LeafContentRect | undefined, right: LeafContentRect) {
  return (
    !!left &&
    Math.abs(left.left - right.left) < 0.5 &&
    Math.abs(left.top - right.top) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5
  );
}

function collectTabPlacements(
  node: TerminalWindowNode,
  tabsById: Map<string, Tab>,
): TabPlacement[] {
  if (isTerminalWindowSplit(node)) {
    return [
      ...collectTabPlacements(node.first, tabsById),
      ...collectTabPlacements(node.second, tabsById),
    ];
  }

  const tabs = node.tabIds.map((tabId) => tabsById.get(tabId)).filter((tab): tab is Tab => !!tab);
  const activeTab =
    (node.activeTabId ? tabs.find((tab) => tab.id === node.activeTabId) : null) ?? tabs[0] ?? null;

  return tabs.map((tab) => ({
    tab,
    leafId: node.id,
    active: activeTab?.id === tab.id,
  }));
}

function collectLeafTabIds(node: TerminalWindowNode): Map<string, string[]> {
  const leaves = new Map<string, string[]>();

  const visit = (current: TerminalWindowNode) => {
    if (isTerminalWindowSplit(current)) {
      visit(current.first);
      visit(current.second);
      return;
    }
    leaves.set(current.id, current.tabIds);
  };

  visit(node);
  return leaves;
}

function SplitWindow({
  split,
  onUpdateWindowSplitRatio,
  ...props
}: {
  split: TerminalWindowSplit;
} & WindowNodeViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isHorizontal = split.direction === "horizontal";

  const handleResize = (delta: number) => {
    const size = isHorizontal
      ? (containerRef.current?.clientHeight ?? 0)
      : (containerRef.current?.clientWidth ?? 0);
    if (size <= 0) return;
    onUpdateWindowSplitRatio(split.id, split.ratio + delta / size);
  };

  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full min-h-0 min-w-0 ${isHorizontal ? "flex-col" : "flex-row"}`}
    >
      <div
        className="min-h-0 min-w-0"
        style={{
          flexBasis: `${split.ratio * 100}%`,
          flexGrow: 0,
          flexShrink: 0,
        }}
      >
        <WindowNodeView
          node={split.first}
          onUpdateWindowSplitRatio={onUpdateWindowSplitRatio}
          {...props}
        />
      </div>
      <ResizeHandle direction={isHorizontal ? "vertical" : "horizontal"} onResize={handleResize} />
      <div className="min-h-0 min-w-0 flex-1">
        <WindowNodeView
          node={split.second}
          onUpdateWindowSplitRatio={onUpdateWindowSplitRatio}
          {...props}
        />
      </div>
    </div>
  );
}

function LeafWindow({
  leaf,
  tabsById,
  onSelectTab,
  workspaceRef,
  dropState,
  onLeafContentRectChange,
  onLeafDragOver,
  onLeafDragLeave,
  onLeafDrop,
}: {
  leaf: TerminalWindowLeaf;
} & Omit<WindowNodeViewProps, "onUpdateWindowSplitRatio">) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const tabs = useMemo(
    () => leaf.tabIds.map((tabId) => tabsById.get(tabId)).filter((tab): tab is Tab => !!tab),
    [leaf.tabIds, tabsById],
  );
  const activeTab =
    (leaf.activeTabId ? tabs.find((tab) => tab.id === leaf.activeTabId) : null) ?? tabs[0] ?? null;
  const dropZone = dropState?.leafId === leaf.id ? dropState.zone : null;

  useEffect(() => {
    let frame = 0;
    let idleTimer = 0;

    const updateRect = () => {
      const content = contentRef.current;
      const workspace = workspaceRef.current;
      if (!content || !workspace) return;

      const contentRect = content.getBoundingClientRect();
      const workspaceRect = workspace.getBoundingClientRect();
      onLeafContentRectChange(leaf.id, {
        left: contentRect.left - workspaceRect.left,
        top: contentRect.top - workspaceRect.top,
        width: contentRect.width,
        height: contentRect.height,
      });
    };

    const scheduleUpdate = () => {
      // Debounce leaf rect React updates — resize oscillation otherwise floods DevTools.
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(updateRect);
      }, 100);
    };

    scheduleUpdate();

    const observer = new ResizeObserver(scheduleUpdate);
    if (contentRef.current) observer.observe(contentRef.current);
    if (workspaceRef.current) observer.observe(workspaceRef.current);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("nyaterm:refresh-terminals", scheduleUpdate);

    return () => {
      observer.disconnect();
      window.clearTimeout(idleTimer);
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("nyaterm:refresh-terminals", scheduleUpdate);
      onLeafContentRectChange(leaf.id, null);
    };
  }, [leaf.id, onLeafContentRectChange, workspaceRef]);

  return (
    <div
      className="nyaterm-wallpaper-transparent-surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden border"
      style={{
        borderColor: "var(--df-border)",
        backgroundColor: "var(--df-terminal-bg, var(--df-bg-terminal))",
      }}
      onMouseDown={() => {
        if (activeTab) {
          onSelectTab(leaf.id, activeTab.id);
        }
      }}
    >
      <div
        ref={contentRef}
        className="relative flex-1 overflow-hidden"
        onDragOver={(event) => onLeafDragOver(leaf.id, event)}
        onDragLeave={(event) => onLeafDragLeave(leaf.id, event)}
        onDrop={(event) => onLeafDrop(leaf.id, event)}
      >
        {dropZone && <DropZoneOverlay zone={dropZone} />}
      </div>
    </div>
  );
}

function WindowNodeView({
  node,
  tabsById,
  onSelectTab,
  onUpdateWindowSplitRatio,
  workspaceRef,
  dropState,
  onLeafContentRectChange,
  onLeafDragOver,
  onLeafDragLeave,
  onLeafDrop,
}: {
  node: TerminalWindowNode;
} & WindowNodeViewProps) {
  if (isTerminalWindowSplit(node)) {
    return (
      <SplitWindow
        split={node}
        tabsById={tabsById}
        onSelectTab={onSelectTab}
        onUpdateWindowSplitRatio={onUpdateWindowSplitRatio}
        workspaceRef={workspaceRef}
        dropState={dropState}
        onLeafContentRectChange={onLeafContentRectChange}
        onLeafDragOver={onLeafDragOver}
        onLeafDragLeave={onLeafDragLeave}
        onLeafDrop={onLeafDrop}
      />
    );
  }

  return (
    <LeafWindow
      leaf={node}
      tabsById={tabsById}
      onSelectTab={onSelectTab}
      workspaceRef={workspaceRef}
      dropState={dropState}
      onLeafContentRectChange={onLeafContentRectChange}
      onLeafDragOver={onLeafDragOver}
      onLeafDragLeave={onLeafDragLeave}
      onLeafDrop={onLeafDrop}
    />
  );
}

function TerminalContentHost({
  placements,
  leafRects,
  dropState,
  onSelectTab,
  onActivatePane,
  onUpdatePaneSplitRatio,
  onReconnectPane,
  onReconnected,
  onDisconnectedCloseRequested,
  onConnectionError,
  recordingStatuses,
  onToggleSessionRecording,
  onSaveSessionTranscript,
  workbench,
  onLeafDragOver,
  onLeafDragLeave,
  onLeafDrop,
}: {
  placements: TabPlacement[];
  leafRects: Map<string, LeafContentRect>;
  dropState: DropState | null;
  onSelectTab: TabWindowsWorkspaceProps["onSelectTab"];
  onActivatePane: TabWindowsWorkspaceProps["onActivatePane"];
  onUpdatePaneSplitRatio: TabWindowsWorkspaceProps["onUpdatePaneSplitRatio"];
  onReconnectPane?: TabWindowsWorkspaceProps["onReconnectPane"];
  onReconnected?: TabWindowsWorkspaceProps["onReconnected"];
  onDisconnectedCloseRequested?: TabWindowsWorkspaceProps["onDisconnectedCloseRequested"];
  onConnectionError?: TabWindowsWorkspaceProps["onConnectionError"];
  recordingStatuses?: TabWindowsWorkspaceProps["recordingStatuses"];
  onToggleSessionRecording?: TabWindowsWorkspaceProps["onToggleSessionRecording"];
  onSaveSessionTranscript?: TabWindowsWorkspaceProps["onSaveSessionTranscript"];
  workbench?: WorkbenchRenderProps;
  onLeafDragOver: LeafDragHandler;
  onLeafDragLeave: LeafDragHandler;
  onLeafDrop: LeafDragHandler;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {placements.map(({ tab, leafId, active }) => {
        const rect = leafRects.get(leafId);
        const visible = active && !!rect && rect.width > 0 && rect.height > 0;
        const dropZone = dropState?.leafId === leafId ? dropState.zone : null;

        return (
          <div
            key={tab.id}
            className="absolute pointer-events-auto"
            style={{
              display: visible ? "block" : "none",
              left: rect?.left ?? 0,
              top: rect?.top ?? 0,
              width: rect?.width ?? 0,
              height: rect?.height ?? 0,
            }}
            onDragOver={(event) => onLeafDragOver(leafId, event)}
            onDragLeave={(event) => onLeafDragLeave(leafId, event)}
            onDrop={(event) => onLeafDrop(leafId, event)}
          >
            <PaneWorkspace
              tab={tab}
              visible={visible}
              workbench={workbench}
              onActivatePane={(paneId) => {
                onSelectTab(leafId, tab.id);
                onActivatePane(tab.id, paneId);
              }}
              onUpdateSplitRatio={(splitId, ratio) =>
                onUpdatePaneSplitRatio(tab.id, splitId, ratio)
              }
              onReconnectPane={onReconnectPane}
              onReconnected={onReconnected}
              onDisconnectedCloseRequested={onDisconnectedCloseRequested}
              onConnectionError={onConnectionError}
              recordingStatuses={recordingStatuses}
              onToggleSessionRecording={onToggleSessionRecording}
              onSaveSessionTranscript={onSaveSessionTranscript}
            />
            {visible && dropZone && <DropZoneOverlay zone={dropZone} />}
          </div>
        );
      })}
    </div>
  );
}

function TabWindowsWorkspace({
  layout,
  tabsById,
  onMoveTabToLeaf,
  onSplitTabToLeaf,
  onSelectTab,
  onActivatePane,
  onUpdatePaneSplitRatio,
  onUpdateWindowSplitRatio,
  onReconnectPane,
  onReconnected,
  onDisconnectedCloseRequested,
  onConnectionError,
  recordingStatuses,
  onToggleSessionRecording,
  onSaveSessionTranscript,
  workbench,
}: TabWindowsWorkspaceProps) {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [leafRects, setLeafRects] = useState<Map<string, LeafContentRect>>(() => new Map());
  const [dropState, setDropState] = useState<DropState | null>(null);

  const placements = useMemo(
    () => (layout ? collectTabPlacements(layout, tabsById) : []),
    [layout, tabsById],
  );
  const leafTabIds = useMemo(() => (layout ? collectLeafTabIds(layout) : new Map()), [layout]);

  const handleLeafContentRectChange = useCallback<LeafContentRectChange>((leafId, rect) => {
    setLeafRects((current) => {
      if (!rect) {
        if (!current.has(leafId)) return current;
        const next = new Map(current);
        next.delete(leafId);
        return next;
      }

      if (areRectsEqual(current.get(leafId), rect)) return current;
      const next = new Map(current);
      next.set(leafId, rect);
      return next;
    });
  }, []);

  const clearDropState = useCallback(() => {
    setDropState(null);
  }, []);

  useEffect(() => {
    window.addEventListener("blur", clearDropState);
    return () => {
      window.removeEventListener("blur", clearDropState);
    };
  }, [clearDropState]);

  const isTabDragEvent = useCallback((event: DragEvent<HTMLDivElement>) => {
    return event.dataTransfer.types.includes("application/nyaterm-tab");
  }, []);

  const detectDropZone = useCallback(
    (leafId: string, event: DragEvent<HTMLDivElement>): DropZone | null => {
      const workspace = workspaceRef.current;
      const rect = leafRects.get(leafId);
      if (!workspace || !rect || rect.width <= 0 || rect.height <= 0) return null;

      const workspaceRect = workspace.getBoundingClientRect();
      const x = event.clientX - workspaceRect.left - rect.left;
      const y = event.clientY - workspaceRect.top - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;

      const horizontalThreshold = Math.min(180, Math.max(48, rect.width * 0.38));
      const verticalThreshold = Math.min(140, Math.max(40, rect.height * 0.34));
      const edgeDistances = [
        {
          direction: "left" as const,
          distance: x,
          threshold: horizontalThreshold,
        },
        {
          direction: "right" as const,
          distance: rect.width - x,
          threshold: horizontalThreshold,
        },
        {
          direction: "top" as const,
          distance: y,
          threshold: verticalThreshold,
        },
        {
          direction: "bottom" as const,
          distance: rect.height - y,
          threshold: verticalThreshold,
        },
      ];

      const nearestEdge = edgeDistances
        .filter((edge) => edge.distance <= edge.threshold)
        .sort((a, b) => a.distance - b.distance)[0];

      if (nearestEdge) {
        return { type: "edge", direction: nearestEdge.direction };
      }

      return { type: "center" };
    },
    [leafRects],
  );

  const handleLeafDragOver = useCallback<LeafDragHandler>(
    (leafId, event) => {
      if (!isTabDragEvent(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const zone = detectDropZone(leafId, event);
      if (!zone) {
        setDropState((current) => (current?.leafId === leafId ? null : current));
        return;
      }
      setDropState((current) => {
        if (
          current?.leafId === leafId &&
          current.zone.type === zone.type &&
          (zone.type !== "edge" ||
            (current.zone.type === "edge" && current.zone.direction === zone.direction))
        ) {
          return current;
        }
        return { leafId, zone };
      });
    },
    [detectDropZone, isTabDragEvent],
  );

  const handleLeafDragLeave = useCallback<LeafDragHandler>((leafId, event) => {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) {
      return;
    }
    setDropState((current) => (current?.leafId === leafId ? null : current));
  }, []);

  const handleLeafDrop = useCallback<LeafDragHandler>(
    (leafId, event) => {
      if (!isTabDragEvent(event)) {
        clearDropState();
        return;
      }

      const tabId = event.dataTransfer.getData("application/nyaterm-tab");
      const zone = dropState?.leafId === leafId ? dropState.zone : detectDropZone(leafId, event);

      if (!tabId || !zone) {
        clearDropState();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      clearDropState();

      if (zone.type === "edge") {
        onSplitTabToLeaf?.(tabId, leafId, zone.direction);
        return;
      }

      const sourceTabIds = leafTabIds.get(leafId) ?? [];
      if (sourceTabIds.includes(tabId)) return;
      onMoveTabToLeaf?.(tabId, leafId, sourceTabIds.length);
    },
    [
      clearDropState,
      detectDropZone,
      dropState,
      isTabDragEvent,
      leafTabIds,
      onMoveTabToLeaf,
      onSplitTabToLeaf,
    ],
  );

  if (!layout) return null;

  return (
    <div ref={workspaceRef} className="relative h-full w-full min-h-0 min-w-0 overflow-hidden">
      <WindowNodeView
        node={layout}
        tabsById={tabsById}
        onSelectTab={onSelectTab}
        onUpdateWindowSplitRatio={onUpdateWindowSplitRatio}
        workspaceRef={workspaceRef}
        dropState={dropState}
        onLeafContentRectChange={handleLeafContentRectChange}
        onLeafDragOver={handleLeafDragOver}
        onLeafDragLeave={handleLeafDragLeave}
        onLeafDrop={handleLeafDrop}
      />
      <TerminalContentHost
        placements={placements}
        leafRects={leafRects}
        dropState={dropState}
        onSelectTab={onSelectTab}
        onActivatePane={onActivatePane}
        onUpdatePaneSplitRatio={onUpdatePaneSplitRatio}
        onReconnectPane={onReconnectPane}
        onReconnected={onReconnected}
        onDisconnectedCloseRequested={onDisconnectedCloseRequested}
        onConnectionError={onConnectionError}
        recordingStatuses={recordingStatuses}
        onToggleSessionRecording={onToggleSessionRecording}
        onSaveSessionTranscript={onSaveSessionTranscript}
        workbench={workbench}
        onLeafDragOver={handleLeafDragOver}
        onLeafDragLeave={handleLeafDragLeave}
        onLeafDrop={handleLeafDrop}
      />
    </div>
  );
}

export default memo(TabWindowsWorkspace);
