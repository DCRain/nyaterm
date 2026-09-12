import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageDir = path.resolve(
  process.cwd(),
  "node_modules",
  "@xterm",
  "xterm",
  "lib",
);

const cases = [
  {
    name: "ESM",
    file: "xterm.mjs",
    state:
      "this._nyatermWideCharMidpointSelection=this._enabled&&!e.shiftKey&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&e.detail===1",
    startFallback: ":this._model.selectionStart[0]++)",
    endFallback: ":this._model.selectionEnd[0]++)",
  },
  {
    name: "CJS",
    file: "xterm.js",
    state:
      "this._nyatermWideCharMidpointSelection=this._enabled&&!e.shiftKey&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&1===e.detail",
    startFallback: ":this._model.selectionStart[0]++)",
    endFallback: ":this._model.selectionEnd[0]++)",
  },
] as const;

describe("xterm wide-character selection patch", () => {
  it.each(cases)(
    "$name keeps Shift/modified selection on xterm's original wide-cell behavior",
    ({ file, state, startFallback, endFallback }) => {
      const source = fs.readFileSync(path.join(packageDir, file), "utf8");
      const stateName = "_nyatermWideCharMidpointSelection";

      expect(source).toContain("/*nyaterm:wide-char-selection-midpoint*/");
      expect(source).toContain(state);
      expect(source.split(stateName)).toHaveLength(4);

      const startUse = source.indexOf(
        `this.${stateName}?this._model.selectionStart[0]+=`,
      );
      const endUse = source.indexOf(
        `this.${stateName}?this._model.selectionEnd[0]+=`,
      );
      expect(startUse).toBeGreaterThan(-1);
      expect(endUse).toBeGreaterThan(startUse);
      expect(source.slice(startUse, startUse + 500)).toContain(startFallback);
      expect(source.slice(endUse, endUse + 500)).toContain(endFallback);

      // The decision is captured once on mousedown. Mousemove must not switch
      // algorithms based on the modifier state of later events.
      expect(source).not.toContain("_activeSelectionMode===0&&!e.shiftKey?");
      expect(source).not.toContain(
        "0===this._activeSelectionMode&&!e.shiftKey?",
      );
    },
  );
});
