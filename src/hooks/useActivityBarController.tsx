import type { TFunction } from "i18next";
import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { BiServer } from "react-icons/bi";
import { FaRegFolder } from "react-icons/fa";
import { LuKeyRound } from "react-icons/lu";
import {
  MdAutoAwesome,
  MdBackup,
  MdBolt,
  MdHistory,
  MdLan,
  MdLink,
  MdListAlt,
  MdLock,
  MdOutlineMonitorHeart,
  MdOutlineStickyNote2,
  MdSend,
  MdSettings,
} from "react-icons/md";
import { PiRecordFill } from "react-icons/pi";
import { SiDocker, SiNvidia } from "react-icons/si";
import type { ActivityBarItem } from "@/components/layout/ActivityBar";
import {
  buildMultiPanelToggleUpdate,
  getItemSide,
  isActivityItemVisible,
} from "@/lib/appWorkspace";
import { openSettings } from "@/lib/windowManager";
import type { ActivityBarLayout, ActivityBarZone, UiConfig } from "@/types/global";

type UpdateUi = (updates: Partial<UiConfig> | ((prev: UiConfig) => Partial<UiConfig>)) => void;

const ACTIVITY_LAYOUT_ZONES = ["left_top", "left_bottom", "right_top", "right_bottom"] as const;

function insertAfter(ids: string[], anchorId: string, itemId: string) {
  if (ids.includes(itemId)) return ids;
  const next = [...ids];
  const anchorIndex = next.indexOf(anchorId);
  if (anchorIndex === -1) {
    next.unshift(itemId);
  } else {
    next.splice(anchorIndex + 1, 0, itemId);
  }
  return next;
}

function insertBeforeOrPush(ids: string[], anchorId: string, itemId: string) {
  if (ids.includes(itemId)) return ids;
  const next = [...ids];
  const anchorIndex = next.indexOf(anchorId);
  if (anchorIndex === -1) {
    next.push(itemId);
  } else {
    next.splice(anchorIndex, 0, itemId);
  }
  return next;
}

function AscendIcon() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-[1em] w-[1em] bg-current"
      style={{
        WebkitMask: "url('/icons/brands/ascend.svg') center / contain no-repeat",
        mask: "url('/icons/brands/ascend.svg') center / contain no-repeat",
      }}
    />
  );
}

function mergeVisibleReorder(
  currentIds: string[],
  orderedVisibleIds: string[],
  uiConfig: UiConfig,
): string[] {
  const orderedVisibleSet = new Set(orderedVisibleIds);
  const nextVisibleIds = [...orderedVisibleIds];
  const reordered = currentIds.map((id) => {
    if (!orderedVisibleSet.has(id) || !isActivityItemVisible(id, uiConfig)) return id;
    return nextVisibleIds.shift() ?? id;
  });
  return [...reordered, ...nextVisibleIds];
}

function normalizeActivityBarState(uiConfig: UiConfig): Partial<UiConfig> | null {
  const originalLeftOpenPanels = uiConfig.left_open_panels ?? [];
  const originalRightOpenPanels = uiConfig.right_open_panels ?? [];
  const seen = new Set<string>();
  const layout: ActivityBarLayout = {
    ...uiConfig.activity_bar_layout,
    left_top: [],
    left_bottom: [],
    right_top: [],
    right_bottom: [],
  };

  const legacyShowLabels = (
    uiConfig.activity_bar_layout as ActivityBarLayout & { show_labels?: boolean }
  ).show_labels;
  const originalShowLabelsLeft =
    typeof uiConfig.activity_bar_layout.show_labels_left === "boolean"
      ? uiConfig.activity_bar_layout.show_labels_left
      : (legacyShowLabels ?? false);
  const originalShowLabelsRight =
    typeof uiConfig.activity_bar_layout.show_labels_right === "boolean"
      ? uiConfig.activity_bar_layout.show_labels_right
      : (legacyShowLabels ?? false);
  layout.show_labels_left = originalShowLabelsLeft;
  layout.show_labels_right = originalShowLabelsRight;
  layout.show_left =
    typeof uiConfig.activity_bar_layout.show_left === "boolean"
      ? uiConfig.activity_bar_layout.show_left
      : false;
  layout.show_right =
    typeof uiConfig.activity_bar_layout.show_right === "boolean"
      ? uiConfig.activity_bar_layout.show_right
      : false;

  for (const zone of ACTIVITY_LAYOUT_ZONES) {
    for (const id of uiConfig.activity_bar_layout[zone]) {
      if (id === "fileTransfer") continue;
      if (seen.has(id)) continue;
      seen.add(id);
      layout[zone].push(id);
    }
  }

  if (!seen.has("syncBackupHistory")) {
    layout.left_bottom = insertBeforeOrPush(layout.left_bottom, "settings", "syncBackupHistory");
    seen.add("syncBackupHistory");
  }
  if (!seen.has("notes")) {
    layout.left_top = insertAfter(layout.left_top, "fileExplorer", "notes");
    seen.add("notes");
  }
  if (!seen.has("aiAssistant")) {
    layout.right_top = insertAfter(layout.right_top, "savedConnections", "aiAssistant");
    seen.add("aiAssistant");
  }

  if (!seen.has("serialSend")) {
    const quickCmdIndex = layout.right_bottom.indexOf("quickCmdBar");
    const recordingIndex = layout.right_bottom.indexOf("recording");
    const lockIndex = layout.right_bottom.indexOf("lock");
    if (quickCmdIndex !== -1) {
      layout.right_bottom.splice(quickCmdIndex + 1, 0, "serialSend");
    } else if (recordingIndex !== -1) {
      layout.right_bottom.splice(recordingIndex, 0, "serialSend");
    } else if (lockIndex !== -1) {
      layout.right_bottom.splice(lockIndex, 0, "serialSend");
    } else {
      layout.right_bottom.push("serialSend");
    }
    seen.add("serialSend");
  }

  if (!seen.has("recording")) {
    layout.right_bottom = insertBeforeOrPush(layout.right_bottom, "lock", "recording");
    seen.add("recording");
  }
  if (!seen.has("gpuMonitor")) {
    layout.right_top = insertAfter(layout.right_top, "resourceMonitor", "gpuMonitor");
    seen.add("gpuMonitor");
  }
  if (!seen.has("ascendNpuMonitor")) {
    layout.right_top = insertAfter(layout.right_top, "gpuMonitor", "ascendNpuMonitor");
    seen.add("ascendNpuMonitor");
  }
  if (!seen.has("processManager")) {
    layout.right_top = insertAfter(layout.right_top, "ascendNpuMonitor", "processManager");
    seen.add("processManager");
  }
  if (!seen.has("dockerManager")) {
    layout.right_top = insertAfter(layout.right_top, "processManager", "dockerManager");
    seen.add("dockerManager");
  }

  const leftPanelIds = new Set(
    [...layout.left_top, ...layout.left_bottom].filter((id) => isActivityItemVisible(id, uiConfig)),
  );
  const rightPanelIds = new Set(
    [...layout.right_top, ...layout.right_bottom].filter((id) =>
      isActivityItemVisible(id, uiConfig),
    ),
  );
  const leftOpenPanels = [...new Set(originalLeftOpenPanels)].filter((id) => leftPanelIds.has(id));
  const rightOpenPanels = [...new Set(originalRightOpenPanels)].filter((id) =>
    rightPanelIds.has(id),
  );
  const activeLeftPanel =
    uiConfig.active_left_panel && leftPanelIds.has(uiConfig.active_left_panel)
      ? uiConfig.active_left_panel
      : uiConfig.active_left_panel === "fileTransfer" && leftPanelIds.has("fileExplorer")
        ? "fileExplorer"
        : null;
  const activeRightPanel =
    uiConfig.active_right_panel && rightPanelIds.has(uiConfig.active_right_panel)
      ? uiConfig.active_right_panel
      : null;

  const layoutChanged =
    ACTIVITY_LAYOUT_ZONES.some(
      (zone) =>
        layout[zone].length !== uiConfig.activity_bar_layout[zone].length ||
        layout[zone].some((id, index) => id !== uiConfig.activity_bar_layout[zone][index]),
    ) ||
    layout.show_labels_left !== uiConfig.activity_bar_layout.show_labels_left ||
    layout.show_labels_right !== uiConfig.activity_bar_layout.show_labels_right ||
    layout.show_left !== uiConfig.activity_bar_layout.show_left ||
    layout.show_right !== uiConfig.activity_bar_layout.show_right;
  const leftOpenChanged =
    leftOpenPanels.length !== originalLeftOpenPanels.length ||
    leftOpenPanels.some((id, index) => id !== originalLeftOpenPanels[index]);
  const rightOpenChanged =
    rightOpenPanels.length !== originalRightOpenPanels.length ||
    rightOpenPanels.some((id, index) => id !== originalRightOpenPanels[index]);
  const activeLeftChanged = activeLeftPanel !== uiConfig.active_left_panel;
  const activeRightChanged = activeRightPanel !== uiConfig.active_right_panel;

  if (
    !layoutChanged &&
    !leftOpenChanged &&
    !rightOpenChanged &&
    !activeLeftChanged &&
    !activeRightChanged
  ) {
    return null;
  }

  return {
    ...(layoutChanged ? { activity_bar_layout: layout } : {}),
    ...(leftOpenChanged ? { left_open_panels: leftOpenPanels } : {}),
    ...(rightOpenChanged ? { right_open_panels: rightOpenPanels } : {}),
    ...(activeLeftChanged ? { active_left_panel: activeLeftPanel } : {}),
    ...(activeRightChanged ? { active_right_panel: activeRightPanel } : {}),
  };
}

interface UseActivityBarControllerOptions {
  uiConfig: UiConfig;
  recordingSessions: Set<string>;
  multiPanelOpen: boolean;
  updateUi: UpdateUi;
  setIsLocked: (locked: boolean) => void;
  t: TFunction;
}

export function useActivityBarController({
  uiConfig,
  recordingSessions,
  multiPanelOpen,
  updateUi,
  setIsLocked,
  t,
}: UseActivityBarControllerOptions) {
  const itemRegistry = useMemo<Record<string, { icon: ReactNode; tooltip: string }>>(
    () => ({
      fileExplorer: { icon: <FaRegFolder />, tooltip: t("panel.fileExplorer") },
      notes: { icon: <MdOutlineStickyNote2 />, tooltip: t("panel.notes") },
      network: { icon: <MdLan />, tooltip: t("panel.network") },
      securityAuth: { icon: <LuKeyRound />, tooltip: t("securityAuth.title") },
      syncBackupHistory: { icon: <MdBackup />, tooltip: t("panel.syncBackupHistory") },
      settings: { icon: <MdSettings />, tooltip: t("settings.title") },
      savedConnections: { icon: <BiServer />, tooltip: t("panel.savedConnections") },
      aiAssistant: { icon: <MdAutoAwesome />, tooltip: t("ai.title") },
      activeSessions: { icon: <MdLink />, tooltip: t("panel.activeSessions") },
      commandHistory: { icon: <MdHistory />, tooltip: t("panel.commandHistory") },
      resourceMonitor: { icon: <MdOutlineMonitorHeart />, tooltip: t("panel.resourceMonitor") },
      gpuMonitor: { icon: <SiNvidia />, tooltip: t("panel.gpuMonitor") },
      ascendNpuMonitor: { icon: <AscendIcon />, tooltip: t("panel.ascendNpuMonitor") },
      processManager: { icon: <MdListAlt />, tooltip: t("panel.processManager") },
      dockerManager: { icon: <SiDocker />, tooltip: t("panel.dockerManager") },
      quickCmdBar: { icon: <MdBolt />, tooltip: t("panel.quickCommands") },
      serialSend: { icon: <MdSend />, tooltip: t("panel.serialSend", "Command Send") },
      recording: {
        icon: <PiRecordFill className={recordingSessions.size > 0 ? "animate-pulse" : undefined} />,
        tooltip: t("recording.panelTitle"),
      },
      lock: { icon: <MdLock />, tooltip: t("statusBar.lock") },
    }),
    [recordingSessions, t],
  );

  const layout = uiConfig.activity_bar_layout;

  useEffect(() => {
    if (!normalizeActivityBarState(uiConfig)) return;
    updateUi((prev) => {
      return normalizeActivityBarState(prev) ?? {};
    });
  }, [uiConfig, updateUi]);

  const buildItems = useCallback(
    (ids: string[]): ActivityBarItem[] =>
      ids
        .filter((id) => id in itemRegistry && isActivityItemVisible(id, uiConfig))
        .map((id) => ({ id, ...itemRegistry[id] })),
    [itemRegistry, uiConfig],
  );

  const leftTopItems = useMemo(() => buildItems(layout.left_top), [buildItems, layout.left_top]);
  const leftBottomItems = useMemo(
    () => buildItems(layout.left_bottom),
    [buildItems, layout.left_bottom],
  );
  const rightTopItems = useMemo(() => buildItems(layout.right_top), [buildItems, layout.right_top]);
  const rightBottomItems = useMemo(
    () => buildItems(layout.right_bottom),
    [buildItems, layout.right_bottom],
  );

  const toggleActiveIds = useMemo(() => {
    const activeIds = new Set<string>();
    if (uiConfig.show_quick_cmd_bar) activeIds.add("quickCmdBar");
    if (uiConfig.show_serial_send_panel) activeIds.add("serialSend");
    if (recordingSessions.size > 0) activeIds.add("recording");
    return activeIds;
  }, [recordingSessions, uiConfig.show_quick_cmd_bar, uiConfig.show_serial_send_panel]);

  useEffect(() => {
    if (!uiConfig.show_quick_cmd_bar || !uiConfig.show_serial_send_panel) return;
    updateUi({ show_quick_cmd_bar: false });
  }, [uiConfig.show_quick_cmd_bar, uiConfig.show_serial_send_panel, updateUi]);

  const handleItemSelect = useCallback(
    (id: string) => {
      if (id === "settings") {
        openSettings();
        return;
      }
      if (id === "lock") {
        setIsLocked(true);
        return;
      }
      if (id === "quickCmdBar") {
        updateUi((prev) => ({
          show_quick_cmd_bar: !prev.show_quick_cmd_bar,
          ...(prev.show_serial_send_panel ? { show_serial_send_panel: false } : {}),
        }));
        return;
      }
      if (id === "serialSend") {
        updateUi((prev) => ({
          show_serial_send_panel: !prev.show_serial_send_panel,
          ...(prev.show_quick_cmd_bar ? { show_quick_cmd_bar: false } : {}),
        }));
        return;
      }
      const side = getItemSide(id, layout);
      if (!side) return;
      if (multiPanelOpen) {
        updateUi((prev) => buildMultiPanelToggleUpdate(prev, id, side));
        return;
      }
      if (side === "left") {
        updateUi((prev) => ({ active_left_panel: prev.active_left_panel === id ? null : id }));
      } else if (side === "right") {
        updateUi((prev) => ({ active_right_panel: prev.active_right_panel === id ? null : id }));
      }
    },
    [layout, multiPanelOpen, setIsLocked, updateUi],
  );

  const handleReorder = useCallback(
    (side: "left" | "right", zoneKey: "top" | "bottom", orderedIds: string[]) => {
      const layoutKey = `${side}_${zoneKey}` as ActivityBarZone;
      updateUi((prev) => ({
        activity_bar_layout: {
          ...prev.activity_bar_layout,
          [layoutKey]: mergeVisibleReorder(prev.activity_bar_layout[layoutKey], orderedIds, prev),
        },
      }));
    },
    [updateUi],
  );

  const handleMoveItem = useCallback(
    (itemId: string, targetZone: ActivityBarZone) => {
      updateUi((prev) => {
        const zones = ["left_top", "left_bottom", "right_top", "right_bottom"] as const;
        const newLayout = { ...prev.activity_bar_layout };
        for (const zone of zones) {
          newLayout[zone] = newLayout[zone].filter((id) => id !== itemId);
        }
        newLayout[targetZone] = [...newLayout[targetZone], itemId];
        const isMovingToRight = targetZone === "right_top" || targetZone === "right_bottom";
        const isMovingToLeft = targetZone === "left_top" || targetZone === "left_bottom";
        return {
          activity_bar_layout: newLayout,
          ...(prev.active_left_panel === itemId && isMovingToRight
            ? { active_left_panel: null }
            : {}),
          ...(prev.active_right_panel === itemId && isMovingToLeft
            ? { active_right_panel: null }
            : {}),
          ...(isMovingToRight && prev.left_open_panels?.includes(itemId)
            ? { left_open_panels: prev.left_open_panels.filter((id) => id !== itemId) }
            : {}),
          ...(isMovingToLeft && prev.right_open_panels?.includes(itemId)
            ? { right_open_panels: prev.right_open_panels.filter((id) => id !== itemId) }
            : {}),
        };
      });
    },
    [updateUi],
  );

  const handleToggleLabel = useCallback(
    (side: "left" | "right") => {
      updateUi((prev) => ({
        activity_bar_layout: {
          ...prev.activity_bar_layout,
          ...(side === "left"
            ? { show_labels_left: !prev.activity_bar_layout.show_labels_left }
            : { show_labels_right: !prev.activity_bar_layout.show_labels_right }),
        },
      }));
    },
    [updateUi],
  );

  const handleToggleVisibility = useCallback(
    (side: "left" | "right") => {
      updateUi((prev) => ({
        activity_bar_layout: {
          ...prev.activity_bar_layout,
          ...(side === "left"
            ? { show_left: !prev.activity_bar_layout.show_left }
            : { show_right: !prev.activity_bar_layout.show_right }),
        },
      }));
    },
    [updateUi],
  );

  return {
    leftTopItems,
    leftBottomItems,
    rightTopItems,
    rightBottomItems,
    showLabelsLeft: layout.show_labels_left,
    showLabelsRight: layout.show_labels_right,
    showLeft: layout.show_left,
    showRight: layout.show_right,
    toggleActiveIds,
    handleItemSelect,
    handleReorder,
    handleMoveItem,
    handleToggleLabel,
    handleToggleVisibility,
  };
}
