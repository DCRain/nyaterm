import { listen } from "@tauri-apps/api/event";
import type { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  normalizeCommandSuggestionMaxChars,
  normalizeCommandSuggestionMinChars,
} from "@/lib/interactionSettings";
import { invoke } from "@/lib/invoke";
import { getTrackedCommand, type TerminalInputState } from "@/lib/terminalInputTracker";
import type { SuggestionCursorPosition } from "@/lib/terminalSuggestionPosition";
import type { FuzzyResult, QuickCommandsConfig } from "@/types/global";

interface XTermCoreWithRenderDimensions {
  _core?: {
    _renderService?: {
      dimensions?: {
        css: {
          cell: {
            height: number;
            width: number;
          };
        };
      };
    };
  };
}

interface CommandHistorySearchOptions {
  manual?: boolean;
}

/** Debounce keystrokes before hitting the backend fuzzy search. */
const SUGGESTION_SEARCH_DEBOUNCE_MS = 160;
const EMPTY_MANUAL_HISTORY_LIMIT = 8;
const EMPTY_MANUAL_QUICK_COMMAND_LIMIT = 8;

function sameSuggestions(a: FuzzyResult[], b: FuzzyResult[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.command !== right.command ||
      left.source !== right.source ||
      left.score !== right.score ||
      left.display !== right.display
    ) {
      return false;
    }
    if (left.indices.length !== right.indices.length) {
      return false;
    }
    for (let j = 0; j < left.indices.length; j += 1) {
      if (left.indices[j] !== right.indices[j]) {
        return false;
      }
    }
  }
  return true;
}

function sameCursorPosition(
  a: SuggestionCursorPosition,
  b: SuggestionCursorPosition,
): boolean {
  return a.top === b.top && a.left === b.left && a.lineTop === b.lineTop;
}

function isWithinCommandLengthLimits(command: string, minLength: number, maxLength: number) {
  const length = command.trim().length;
  return length >= minLength && length <= maxLength;
}

function quickCommandRank(command: QuickCommandsConfig["commands"][number]) {
  const useCount = command.use_count ?? 0;
  const updatedAt = command.updated_at ?? command.created_at ?? 0;
  return (command.pinned ? 1_000_000_000 : 0) + useCount * 1_000_000 + updatedAt;
}

export function useCommandHistory(
  terminalRef: React.RefObject<Terminal | null>,
  inputStateRef: React.RefObject<TerminalInputState>,
  applySuggestion: (command: string, execute: boolean) => void,
  canShowSuggestions: (options?: { allowEmpty?: boolean }) => boolean,
  enabled: boolean,
  minCommandLength: number,
  maxCommandLength: number,
) {
  const [suggestions, setSuggestions] = useState<FuzzyResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [cursorPosition, setCursorPosition] = useState<SuggestionCursorPosition>({
    top: 0,
    left: 0,
  });

  const suggestionsRef = useRef<FuzzyResult[]>([]);
  const selectedIndexRef = useRef(-1);
  const showSuggestionsRef = useRef(false);
  const cursorPositionRef = useRef<SuggestionCursorPosition>({ top: 0, left: 0 });
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);
  const minCommandLengthRef = useRef(normalizeCommandSuggestionMinChars(minCommandLength));
  const maxCommandLengthRef = useRef(normalizeCommandSuggestionMaxChars(maxCommandLength));
  const searchRequestIdRef = useRef(0);
  const lastSearchedPatternRef = useRef<string | null>(null);
  const searchInFlightRef = useRef(false);
  const pendingPatternRef = useRef<string | null>(null);
  const deletedHistoryCommandsRef = useRef(new Set<string>());
  const deletedHistoryCommandTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const getCursorViewportPosition = useCallback((): SuggestionCursorPosition => {
    try {
      const terminal = terminalRef.current;
      if (!terminal) return { top: 0, left: 0 };
      const core = (terminal as Terminal & XTermCoreWithRenderDimensions)._core;
      const dims = core?._renderService?.dimensions;
      if (!dims) return { top: 0, left: 0 };
      const cellHeight: number = dims.css.cell.height;
      const cellWidth: number = dims.css.cell.width;

      const cursorY = terminal.buffer.active.cursorY;
      const cursorX = terminal.buffer.active.cursorX;

      const screenEl = terminal.element?.querySelector(".xterm-screen");
      if (!screenEl) return { top: 0, left: 0 };

      const screenRect = screenEl.getBoundingClientRect();

      return {
        top: screenRect.top + (cursorY + 1) * cellHeight,
        left: screenRect.left + cursorX * cellWidth,
        lineTop: screenRect.top + cursorY * cellHeight,
      };
    } catch {
      return { top: 0, left: 0 };
    }
  }, [terminalRef]);

  const dismissSuggestions = useCallback(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    searchRequestIdRef.current += 1;
    pendingPatternRef.current = null;
    lastSearchedPatternRef.current = null;
    if (
      !showSuggestionsRef.current &&
      suggestionsRef.current.length === 0 &&
      selectedIndexRef.current === -1
    ) {
      return;
    }
    showSuggestionsRef.current = false;
    suggestionsRef.current = [];
    selectedIndexRef.current = -1;
    setSuggestions([]);
    setSelectedIndex(-1);
    setShowSuggestions(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      dismissSuggestions();
    }
  }, [enabled, dismissSuggestions]);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
      for (const timer of deletedHistoryCommandTimersRef.current.values()) {
        clearTimeout(timer);
      }
      deletedHistoryCommandTimersRef.current.clear();
    };
  }, []);

  const applySearchResults = useCallback(
    (merged: FuzzyResult[]) => {
      const unchanged =
        sameSuggestions(suggestionsRef.current, merged) &&
        showSuggestionsRef.current === merged.length > 0 &&
        selectedIndexRef.current === -1;

      suggestionsRef.current = merged;
      selectedIndexRef.current = -1;
      showSuggestionsRef.current = merged.length > 0;

      if (!unchanged) {
        setSuggestions(merged);
        setSelectedIndex(-1);
        setShowSuggestions(merged.length > 0);
      }

      if (merged.length > 0) {
        const nextPosition = getCursorViewportPosition();
        if (!sameCursorPosition(cursorPositionRef.current, nextPosition)) {
          cursorPositionRef.current = nextPosition;
          setCursorPosition(nextPosition);
        }
      }
    },
    [getCursorViewportPosition],
  );

  const runSearch = useCallback(
    async (requestId: number, options: CommandHistorySearchOptions = {}) => {
      if (requestId !== searchRequestIdRef.current) {
        return;
      }

      if (!enabledRef.current) {
        dismissSuggestions();
        return;
      }

      const pattern = getTrackedCommand(inputStateRef.current);
      if (!pattern.trim() && options.manual) {
        try {
          const [history, quickCommands] = await Promise.all([
            invoke<string[]>("get_command_history"),
            invoke<QuickCommandsConfig>("get_quick_commands"),
          ]);
          if (requestId !== searchRequestIdRef.current || !enabledRef.current) {
            return;
          }

          const historyResults: FuzzyResult[] = history
            .filter((command) =>
              isWithinCommandLengthLimits(
                command,
                minCommandLengthRef.current,
                maxCommandLengthRef.current,
              ),
            )
            .filter((command) => !deletedHistoryCommandsRef.current.has(command))
            .slice(0, EMPTY_MANUAL_HISTORY_LIMIT)
            .map((command, index) => ({
              command,
              display: command,
              indices: [],
              score: 2_000 - index,
              source: "history",
            }));

          const quickCommandResults: FuzzyResult[] = quickCommands.commands
            .filter((command) => command.command.trim())
            .sort((left, right) => quickCommandRank(right) - quickCommandRank(left))
            .slice(0, EMPTY_MANUAL_QUICK_COMMAND_LIMIT)
            .map((quickCommand, index) => ({
              command: quickCommand.command,
              display: quickCommand.label || quickCommand.command,
              indices: [],
              score: 1_000 - index,
              source: "quickCommand",
            }));

          applySearchResults([...historyResults, ...quickCommandResults].slice(0, 12));
        } catch {
          // Ignore errors
        }
        return;
      }

      if (!pattern.trim() || !canShowSuggestions()) {
        dismissSuggestions();
        return;
      }

      if (searchInFlightRef.current) {
        pendingPatternRef.current = pattern;
        return;
      }

      searchInFlightRef.current = true;
      lastSearchedPatternRef.current = pattern;

      try {
        const [historyResults, commandResults] = await Promise.all([
          invoke<FuzzyResult[]>("fuzzy_search_history", {
            pattern,
            limit: 8,
            minCommandLength: minCommandLengthRef.current,
            maxCommandLength: maxCommandLengthRef.current,
          }),
          invoke<FuzzyResult[]>("fuzzy_search_commands", { pattern, limit: 8 }),
        ]);
        if (requestId !== searchRequestIdRef.current) {
          return;
        }

        const merged = [...historyResults, ...commandResults]
          .filter(
            (result) =>
              result.source !== "history" || !deletedHistoryCommandsRef.current.has(result.command),
          )
          .sort((a, b) => b.score - a.score)
          .slice(0, 12);

        if (!enabledRef.current) {
          dismissSuggestions();
          return;
        }

        applySearchResults(merged);
      } catch {
        // Ignore errors
      } finally {
        searchInFlightRef.current = false;
        const pendingPattern = pendingPatternRef.current;
        pendingPatternRef.current = null;
        if (
          pendingPattern &&
          pendingPattern !== lastSearchedPatternRef.current &&
          enabledRef.current &&
          canShowSuggestions()
        ) {
          const nextRequestId = ++searchRequestIdRef.current;
          void runSearch(nextRequestId, options);
        }
      }
    },
    [applySearchResults, canShowSuggestions, dismissSuggestions, inputStateRef],
  );

  const triggerSearch = useCallback(
    (options: CommandHistorySearchOptions = {}) => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
      const requestId = ++searchRequestIdRef.current;

      if (!enabledRef.current) {
        dismissSuggestions();
        return;
      }

      if (!canShowSuggestions({ allowEmpty: options.manual })) {
        dismissSuggestions();
        return;
      }

      if (options.manual) {
        void runSearch(requestId, options);
        return;
      }

      searchTimerRef.current = setTimeout(() => {
        if (requestId !== searchRequestIdRef.current) {
          return;
        }

        if (!enabledRef.current) {
          dismissSuggestions();
          return;
        }

        const pattern = getTrackedCommand(inputStateRef.current);
        if (!pattern.trim() || !canShowSuggestions()) {
          dismissSuggestions();
          return;
        }

        if (pattern === lastSearchedPatternRef.current) {
          if (showSuggestionsRef.current) {
            const nextPosition = getCursorViewportPosition();
            if (!sameCursorPosition(cursorPositionRef.current, nextPosition)) {
              cursorPositionRef.current = nextPosition;
              setCursorPosition(nextPosition);
            }
          }
          return;
        }

        void runSearch(requestId, options);
      }, SUGGESTION_SEARCH_DEBOUNCE_MS);
    },
    [
      canShowSuggestions,
      dismissSuggestions,
      getCursorViewportPosition,
      inputStateRef,
      runSearch,
    ],
  );

  useEffect(() => {
    minCommandLengthRef.current = normalizeCommandSuggestionMinChars(
      minCommandLength,
      maxCommandLength,
    );
    maxCommandLengthRef.current = normalizeCommandSuggestionMaxChars(
      maxCommandLength,
      minCommandLengthRef.current,
    );

    if (!enabledRef.current) return;
    if (!canShowSuggestions()) {
      dismissSuggestions();
      return;
    }

    triggerSearch();
  }, [canShowSuggestions, dismissSuggestions, maxCommandLength, minCommandLength, triggerSearch]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: inputStateRef is a stable ref object; .current is read inside the event callback.
  useEffect(() => {
    const refreshSuggestions = () => {
      if (!enabledRef.current) return;
      const tracked = getTrackedCommand(inputStateRef.current).trim();
      if (!showSuggestionsRef.current && !tracked) return;
      if (!canShowSuggestions()) return;
      lastSearchedPatternRef.current = null;
      triggerSearch();
    };

    const historyListener = listen("command-history-changed", refreshSuggestions);
    const quickCommandsListener = listen("quick-commands-changed", refreshSuggestions);

    return () => {
      historyListener.then((unlisten) => unlisten());
      quickCommandsListener.then((unlisten) => unlisten());
    };
  }, [canShowSuggestions, triggerSearch]);

  const handleSelectSuggestion = useCallback(
    (command: string) => {
      applySuggestion(command, false);
      dismissSuggestions();
      terminalRef.current?.focus();
    },
    [applySuggestion, dismissSuggestions, terminalRef],
  );

  const handleDeleteSuggestion = useCallback(
    (command: string) => {
      deletedHistoryCommandsRef.current.add(command);
      const existingTimer = deletedHistoryCommandTimersRef.current.get(command);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      const cleanupTimer = setTimeout(() => {
        deletedHistoryCommandsRef.current.delete(command);
        deletedHistoryCommandTimersRef.current.delete(command);
      }, 5000);
      deletedHistoryCommandTimersRef.current.set(command, cleanupTimer);

      const nextSuggestions = suggestionsRef.current.filter(
        (suggestion) => suggestion.source !== "history" || suggestion.command !== command,
      );
      suggestionsRef.current = nextSuggestions;

      const nextSelectedIndex =
        selectedIndexRef.current >= nextSuggestions.length
          ? nextSuggestions.length - 1
          : selectedIndexRef.current;
      selectedIndexRef.current = Math.max(-1, nextSelectedIndex);

      showSuggestionsRef.current = nextSuggestions.length > 0;
      setSuggestions(nextSuggestions);
      setSelectedIndex(selectedIndexRef.current);
      setShowSuggestions(nextSuggestions.length > 0);

      void invoke("delete_command_history", { command }).catch(() => {});
      terminalRef.current?.focus();
    },
    [terminalRef],
  );

  return {
    suggestions,
    selectedIndex,
    setSelectedIndex,
    showSuggestions,
    cursorPosition,
    suggestionsRef,
    selectedIndexRef,
    showSuggestionsRef,
    searchTimerRef,
    triggerSearch,
    dismissSuggestions,
    handleSelectSuggestion,
    handleDeleteSuggestion,
  };
}
