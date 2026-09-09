import { useCallback, useMemo } from "react";
import {
  type ActivitySessionContext,
  clearInapplicableFloatingPanels,
  isActivityItemApplicable,
  resolveActivitySessionContext,
  stickyBottomPanelPatch,
} from "@/lib/activityBarSessionCapabilities";
import {
  type FloatingPanelsState,
  getSideOpenPanels,
  getSideOverlayPanel,
  isActivityBarItemVisible,
} from "@/lib/appWorkspace";
import type { SessionInfo, SessionPane, UiConfig } from "@/types/global";

export interface UseActivitySessionCapabilitiesOptions {
  activePane: SessionPane | null | undefined;
  liveSessionsById?: Map<string, SessionInfo> | null;
  uiConfig: UiConfig;
  multiPanelOpen: boolean;
  floatingPanels: FloatingPanelsState;
}

export function useActivitySessionCapabilities({
  activePane,
  liveSessionsById,
  uiConfig,
  multiPanelOpen,
  floatingPanels,
}: UseActivitySessionCapabilitiesOptions) {
  const sessionContext = useMemo(
    () => resolveActivitySessionContext(activePane, liveSessionsById),
    [activePane, liveSessionsById],
  );

  const isApplicable = useCallback(
    (id: string) => isActivityItemApplicable(id, sessionContext),
    [sessionContext],
  );

  const isVisibleOnBar = useCallback(
    (id: string) => isActivityBarItemVisible(id, uiConfig) && isApplicable(id),
    [isApplicable, uiConfig],
  );

  const leftPanelIds = useMemo(
    () => getSideOpenPanels(uiConfig, "left", multiPanelOpen).filter(isApplicable),
    [isApplicable, multiPanelOpen, uiConfig],
  );
  const rightPanelIds = useMemo(
    () => getSideOpenPanels(uiConfig, "right", multiPanelOpen).filter(isApplicable),
    [isApplicable, multiPanelOpen, uiConfig],
  );

  const leftOverlayPanelId = useMemo(() => {
    const id = getSideOverlayPanel(uiConfig, "left", multiPanelOpen);
    return id && isApplicable(id) ? id : null;
  }, [isApplicable, multiPanelOpen, uiConfig]);

  const rightOverlayPanelId = useMemo(() => {
    const id = getSideOverlayPanel(uiConfig, "right", multiPanelOpen);
    return id && isApplicable(id) ? id : null;
  }, [isApplicable, multiPanelOpen, uiConfig]);

  const effectiveFloatingPanels = useMemo(
    () => clearInapplicableFloatingPanels(floatingPanels, sessionContext),
    [floatingPanels, sessionContext],
  );

  const effectiveShowQuickCmd =
    Boolean(uiConfig.show_quick_cmd_bar) && isApplicable("quickCmdBar");
  const effectiveShowSerialSend =
    Boolean(uiConfig.show_serial_send_panel) && isApplicable("serialSend");

  const stickyPatch = useMemo(
    () =>
      stickyBottomPanelPatch(
        Boolean(uiConfig.show_quick_cmd_bar),
        Boolean(uiConfig.show_serial_send_panel),
        sessionContext,
      ),
    [sessionContext, uiConfig.show_quick_cmd_bar, uiConfig.show_serial_send_panel],
  );

  return {
    sessionContext,
    isApplicable,
    isVisibleOnBar,
    leftPanelIds,
    rightPanelIds,
    leftOverlayPanelId,
    rightOverlayPanelId,
    effectiveFloatingPanels,
    effectiveShowQuickCmd,
    effectiveShowSerialSend,
    stickyPatch,
  };
}

export type { ActivitySessionContext };
