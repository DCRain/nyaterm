const SETTINGS_GROUP_DEFAULT_TABS: Record<string, string> = {
  ai: "ai-general",
  ai_group: "ai-general",
  security_group: "security",
  syncBackup_group: "syncBackup",
  terminal: "terminal-general",
  terminal_session: "terminal-general",
  transfer_group: "transfer",
  workspace: "general",
};

export function normalizeSettingsSection(tab: string) {
  return SETTINGS_GROUP_DEFAULT_TABS[tab] ?? tab;
}
