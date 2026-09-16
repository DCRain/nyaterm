import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { collectSessionPanes, createSessionPane, createWorkspaceTab } from "./workspaceTabs";
import { findSettingsTab, openSettingsTabInTabs } from "./settingsTab";

describe("openSettingsTabInTabs", () => {
  const settingsTitle = i18n.t("settings.title");

  it("creates a settings tab on first open", () => {
    const result = openSettingsTabInTabs([], undefined, settingsTitle);
    expect(result.created).toBe(true);
    expect(result.tabs).toHaveLength(1);
    expect(result.activeTabId).toBe(result.tabs[0]?.id);
    const pane = collectSessionPanes(result.tabs[0]!.root)[0];
    expect(pane?.view).toBe("settings");
    expect(pane?.settingsSection).toBe("general");
  });

  it("focuses the existing settings tab on second open", () => {
    const first = openSettingsTabInTabs([], undefined, settingsTitle);
    const second = openSettingsTabInTabs(first.tabs, undefined, settingsTitle);
    expect(second.created).toBe(false);
    expect(second.tabs).toHaveLength(1);
    expect(second.activeTabId).toBe(first.activeTabId);
  });

  it("updates the settings section when a section is provided", () => {
    const first = openSettingsTabInTabs([], "appearance", settingsTitle);
    const second = openSettingsTabInTabs(first.tabs, "ai", settingsTitle);
    const pane = collectSessionPanes(second.tabs[0]!.root)[0];
    expect(pane?.settingsSection).toBe("ai-general");
  });

  it("keeps only one settings tab across the workspace", () => {
    const otherTab = createWorkspaceTab(
      createSessionPane("Host", "SSH", "ssh-1", { sessionId: "session-ssh" }),
      0,
    );
    const opened = openSettingsTabInTabs([otherTab], "security", settingsTitle);
    expect(opened.tabs).toHaveLength(2);
    expect(findSettingsTab(opened.tabs)?.tab.id).toBe(opened.activeTabId);
    const reopened = openSettingsTabInTabs(opened.tabs, "general", settingsTitle);
    expect(reopened.tabs).toHaveLength(2);
    expect(
      reopened.tabs.flatMap((tab) => collectSessionPanes(tab.root)).filter((pane) => pane.view === "settings"),
    ).toHaveLength(1);
  });
});
