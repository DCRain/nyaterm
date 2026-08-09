import type { AIOpenIntent } from "@/lib/aiEvents";
import type { AICommandCard, SavedConnection, SessionPane } from "@/types/global";

export interface AIAssistantPanelProps {
  activePane: SessionPane | null;
  activeConnection?: SavedConnection | null;
  intent: AIOpenIntent | null;
  /** False when the panel is kept mounted but hidden; skip background settings churn. */
  isActive?: boolean;
}

export type AICommandExecutionStatus =
  | "idle"
  | "executed"
  | "pending_approval"
  | "rejected"
  | "failed";

export interface AICommandExecutionState {
  status: AICommandExecutionStatus;
  error?: string;
}

export interface QuotedText {
  text: string;
}

export interface ParsedStructuredOutput {
  text: string;
  commandCards: AICommandCard[];
}
