const ALT_SCREEN_PARAMS = new Set(["47", "1047", "1049"]);
const MAX_PENDING_SEQUENCE_CHARS = 32;

export interface AlternateScreenStateSnapshot {
  alternateScreen: boolean;
  pendingSequence: string;
}

function detectAlternateScreen(sequence: string): boolean | null {
  if (!sequence.startsWith("\x1b[?")) return null;
  const final = sequence[sequence.length - 1];
  if (final !== "h" && final !== "l") return null;

  const params = sequence.slice(3, -1).split(";");
  if (!params.some((param) => ALT_SCREEN_PARAMS.has(param))) return null;
  return final === "h";
}

function isPotentialPrefix(text: string): boolean {
  if (!"\x1b[?".startsWith(text) && !text.startsWith("\x1b[?")) return false;
  if (text.length > MAX_PENDING_SEQUENCE_CHARS) return false;
  if (!text.startsWith("\x1b[?")) return true;
  return /^\x1b\[\?[0-9;]*$/u.test(text);
}

function findPendingSequenceSuffix(text: string): string {
  const start = Math.max(0, text.length - MAX_PENDING_SEQUENCE_CHARS);
  for (let index = text.length - 1; index >= start; index -= 1) {
    if (text.charCodeAt(index) !== 0x1b) continue;
    const suffix = text.slice(index);
    if (isPotentialPrefix(suffix)) return suffix;
  }
  return "";
}

export class AlternateScreenStateTracker {
  private alternateScreen = false;
  private pendingSequence = "";

  ingest(data: string): AlternateScreenStateSnapshot {
    if (!data) return this.snapshot();

    const text = `${this.pendingSequence}${data}`;
    this.pendingSequence = "";

    for (let index = 0; index < text.length; index += 1) {
      if (text.charCodeAt(index) !== 0x1b) continue;
      const candidate = text.slice(index, Math.min(text.length, index + MAX_PENDING_SEQUENCE_CHARS));
      const match = /^\x1b\[\?([0-9;]*)([hl])/u.exec(candidate);
      if (!match) continue;

      const next = detectAlternateScreen(match[0]);
      if (next !== null) {
        this.alternateScreen = next;
      }
      index += match[0].length - 1;
    }

    this.pendingSequence = findPendingSequenceSuffix(text);
    return this.snapshot();
  }

  setXtermBufferType(type: string | undefined) {
    if (type === "alternate") {
      this.alternateScreen = true;
      return;
    }
    if (type === "normal") {
      this.alternateScreen = false;
    }
  }

  reset() {
    this.alternateScreen = false;
    this.pendingSequence = "";
  }

  isAlternateScreenActive() {
    return this.alternateScreen;
  }

  snapshot(): AlternateScreenStateSnapshot {
    return {
      alternateScreen: this.alternateScreen,
      pendingSequence: this.pendingSequence,
    };
  }
}
