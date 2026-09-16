import { normalizeSettingsSection } from "@/lib/settingsNavigation";
import type { Tab } from "@/types/global";
import {
  collectSessionPanes,
  createSessionPane,
  createWorkspaceId,
  createWorkspaceTab,
  getNextPersistOrder,
  updateSessionPane,
} from "./workspaceTabs";

export function findSettingsTab(tabs: Tab[]) {
  for (const tab of tabs) {
    const settingsPane = collectSessionPanes(tab.root).find((pane) => pane.view === "settings");
    if (settingsPane) {
      return { tab, settingsPane };
    }
  }
  return null;
}

export function openSettingsTabInTabs(tabs: Tab[], section?: string, title = "Settings") {
  const normalizedSection = section ? normalizeSettingsSection(section) : undefined;
  const existing = findSettingsTab(tabs);

  if (existing) {
    const { tab, settingsPane } = existing;
    let nextTabs = tabs;
    let changed = false;

    if (normalizedSection && settingsPane.settingsSection !== normalizedSection) {
      nextTabs = tabs.map((item) =>
        item.id === tab.id
          ? {
              ...item,
              root: updateSessionPane(item.root, settingsPane.id, {
                settingsSection: normalizedSection,
              }),
            }
          : item,
      );
      changed = true;
    }

    if (tab.activePaneId !== settingsPane.id) {
      nextTabs = nextTabs.map((item) =>
        item.id === tab.id ? { ...item, activePaneId: settingsPane.id } : item,
      );
      changed = true;
    }

    return {
      tabs: changed ? nextTabs : tabs,
      activeTabId: tab.id,
      created: false,
    };
  }

  const pane = createSessionPane(title, "Local", undefined, {
    view: "settings",
    settingsSection: normalizedSection ?? "general",
    connecting: false,
    sessionId: createWorkspaceId("settings"),
  });
  const newTab = createWorkspaceTab(pane, getNextPersistOrder(tabs));

  return {
    tabs: [...tabs, newTab],
    activeTabId: newTab.id,
    created: true,
  };
}
