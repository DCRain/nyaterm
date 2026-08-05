import type { HeaderStatusMode } from "@/types/global";

export const HEADER_STATUS_MODES: HeaderStatusMode[] = [
  "session",
  "resources",
  "host",
  "datetime",
  "gpu",
  "npu",
];

export function normalizeHeaderStatusMode(value?: string): HeaderStatusMode {
  return HEADER_STATUS_MODES.includes(value as HeaderStatusMode)
    ? (value as HeaderStatusMode)
    : "session";
}
