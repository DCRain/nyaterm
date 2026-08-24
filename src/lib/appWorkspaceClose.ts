import type { Tab } from "@/types/global";
import { collectSessionPanes, removeSessionPane } from "./workspaceTabs";

export interface PendingFileDocumentClose {
  paneIds: string[];
  action: () => Promise<void>;
}

export function collectFileDocumentPaneIds(tabs: Tab[]) {
  return tabs.flatMap((tab) =>
    collectSessionPanes(tab.root)
      .filter((pane) => pane.paneKind === "file")
      .map((pane) => pane.id),
  );
}

export function removePaneFromTabs(tabs: Tab[], tabId: string, paneId: string) {
  return tabs.flatMap((tab) => {
    if (tab.id !== tabId) return [tab];
    const root = removeSessionPane(tab.root, paneId);
    return root ? [{ ...tab, root }] : [];
  });
}
