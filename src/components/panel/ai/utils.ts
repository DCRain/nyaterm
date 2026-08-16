import type { CSSProperties } from "react";
import { buildPrismThemeFromColors as buildPrismThemeFromColorsShared } from "@/lib/prismTheme";
import type { ThemeColors } from "@/lib/themes";
import type { AIAction, AIMessage, AISession } from "@/types/global";

export function actionTitle(action: AIAction) {
  switch (action) {
    case "generate_command":
      return "生成命令";
    case "explain_output":
      return "解释最近输出";
    case "explain_selected":
      return "解释选中内容";
    case "analyze_error":
      return "分析错误";
    case "repair_from_selection":
      return "生成修复命令";
    case "custom_terminal_action":
      return "终端 AI 功能";
    case "custom_file_action":
      return "文件 AI 功能";
  }
}

export function createLocalMessage(
  role: "user" | "assistant",
  content: string,
  sessionId = "local",
) {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sessionId,
    role,
    content,
    createdAt: new Date().toISOString(),
    reasoningContent: null,
    commandCards: [],
  } satisfies AIMessage;
}

export function slugCategory(name: string) {
  return `ai-${
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "commands"
  }`;
}

export type DateGroup = "today" | "yesterday" | "last7Days" | "earlier";

function getDateGroup(dateStr: string): DateGroup {
  const date = new Date(dateStr);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const last7Start = new Date(todayStart.getTime() - 6 * 86400000);

  if (date >= todayStart) return "today";
  if (date >= yesterdayStart) return "yesterday";
  if (date >= last7Start) return "last7Days";
  return "earlier";
}

export const dateGroupOrder: DateGroup[] = ["today", "yesterday", "last7Days", "earlier"];

export function groupSessionsByDate(sessions: AISession[]) {
  const groups: Record<DateGroup, AISession[]> = {
    today: [],
    yesterday: [],
    last7Days: [],
    earlier: [],
  };
  for (const session of sessions) {
    groups[getDateGroup(session.updatedAt)].push(session);
  }
  return groups;
}

export function buildPrismThemeFromColors(colors: ThemeColors): Record<string, CSSProperties> {
  return buildPrismThemeFromColorsShared(colors);
}
