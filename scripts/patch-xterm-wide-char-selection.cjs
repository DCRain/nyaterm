#!/usr/bin/env node
/* global process, console */
/**
 * Fix @xterm/xterm drag-selection boundaries for width-2 characters.
 *
 * xterm's selection coordinates use a half-cell offset. When that lands on the
 * continuation cell of a width-2 character, SelectionService currently always
 * advances to the character's right boundary. This makes the effective boundary
 * occur around one quarter of the rendered glyph instead of at its visual center.
 *
 * Fix: only for normal mouse selection, use the same relative pointer coordinate
 * helper and rendered cell width that xterm already uses. A continuation-cell hit
 * snaps left before the wide character on its visual left half and right after it
 * on its visual right half. Other selection modes retain xterm's existing logic.
 *
 * This script is intended for:
 *   @xterm/xterm@6.1.0-beta.288
 *
 * It is idempotent and fails fast when the installed package or minified bundle
 * no longer matches the expected version, so dependency upgrades cannot silently
 * reintroduce the issue.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PACKAGE_NAME = "@xterm/xterm";
const EXPECTED_VERSION = "6.1.0-beta.288";
const MARKER = "/*nyaterm:wide-char-selection-midpoint*/";
const STATE = "_nyatermWideCharMidpointSelection";

const PACKAGE_DIR = path.resolve(
  process.cwd(),
  "node_modules",
  "@xterm",
  "xterm",
);
const PACKAGE_JSON = path.join(PACKAGE_DIR, "package.json");

const TARGETS = [
  {
    file: path.join(PACKAGE_DIR, "lib", "xterm.mjs"),
    // @xterm/xterm@6.1.0-beta.288 ESM bundle
    replacements: [
      {
        label: "normal selection drag state",
        original:
          "e.preventDefault(),this._dragScrollAmount=0,this._enabled&&e.shiftKey?this._handleIncrementalClick(e)",
        patched: `e.preventDefault(),this._dragScrollAmount=0,${MARKER}this.${STATE}=this._enabled&&!e.shiftKey&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&e.detail===1,this._enabled&&e.shiftKey?this._handleIncrementalClick(e)`,
      },
      {
        label: "normal selection start",
        original:
          "r&&r.length!==this._model.selectionStart[0]&&r.hasWidth(this._model.selectionStart[0])===0&&this._model.selectionStart[0]++",
        patched: `r&&r.length!==this._model.selectionStart[0]&&r.hasWidth(this._model.selectionStart[0])===0&&(this.${STATE}?this._model.selectionStart[0]+=qt(this._coreBrowserService.window,e,this._screenElement)[0]<=this._model.selectionStart[0]*this._renderService.dimensions.css.cell.width?-1:1:this._model.selectionStart[0]++)`,
      },
      {
        label: "normal selection end",
        original:
          "s&&s.hasWidth(this._model.selectionEnd[0])===0&&this._model.selectionEnd[0]<this._bufferService.cols&&this._model.selectionEnd[0]++",
        patched: `s&&s.hasWidth(this._model.selectionEnd[0])===0&&this._model.selectionEnd[0]<this._bufferService.cols&&(this.${STATE}?this._model.selectionEnd[0]+=qt(this._coreBrowserService.window,e,this._screenElement)[0]<=this._model.selectionEnd[0]*this._renderService.dimensions.css.cell.width?-1:1:this._model.selectionEnd[0]++)`,
      },
    ],
  },
  {
    file: path.join(PACKAGE_DIR, "lib", "xterm.js"),
    // @xterm/xterm@6.1.0-beta.288 CJS bundle
    replacements: [
      {
        label: "normal selection drag state",
        original:
          "e.preventDefault(),this._dragScrollAmount=0,this._enabled&&e.shiftKey?this._handleIncrementalClick(e)",
        patched: `e.preventDefault(),this._dragScrollAmount=0,${MARKER}this.${STATE}=this._enabled&&!e.shiftKey&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&1===e.detail,this._enabled&&e.shiftKey?this._handleIncrementalClick(e)`,
      },
      {
        label: "normal selection start",
        original:
          "i&&i.length!==this._model.selectionStart[0]&&0===i.hasWidth(this._model.selectionStart[0])&&this._model.selectionStart[0]++",
        patched: `i&&i.length!==this._model.selectionStart[0]&&0===i.hasWidth(this._model.selectionStart[0])&&(this.${STATE}?this._model.selectionStart[0]+=(0,l.getCoordsRelativeToElement)(this._coreBrowserService.window,e,this._screenElement)[0]<=this._model.selectionStart[0]*this._renderService.dimensions.css.cell.width?-1:1:this._model.selectionStart[0]++)`,
      },
      {
        label: "normal selection end",
        original:
          "const i=this._bufferService.buffer;if(this._model.selectionEnd[1]<i.lines.length){const e=i.lines.get(this._model.selectionEnd[1]);e&&0===e.hasWidth(this._model.selectionEnd[0])&&this._model.selectionEnd[0]<this._bufferService.cols&&this._model.selectionEnd[0]++}",
        patched: `const i=this._bufferService.buffer;if(this._model.selectionEnd[1]<i.lines.length){const s=i.lines.get(this._model.selectionEnd[1]);s&&0===s.hasWidth(this._model.selectionEnd[0])&&this._model.selectionEnd[0]<this._bufferService.cols&&(this.${STATE}?this._model.selectionEnd[0]+=(0,l.getCoordsRelativeToElement)(this._coreBrowserService.window,e,this._screenElement)[0]<=this._model.selectionEnd[0]*this._renderService.dimensions.css.cell.width?-1:1:this._model.selectionEnd[0]++)}`,
      },
    ],
  },
];

function fail(message) {
  throw new Error(`[patch-xterm-wide-char-selection] ${message}`);
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function writeFileAtomically(filename, content) {
  const temporary = `${filename}.nyaterm-patch-${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, filename);
}

function verifyPatchedSource(source, relative, replacements) {
  const markerCount = countOccurrences(source, MARKER);
  if (markerCount !== 1) {
    fail(
      `expected exactly one patch marker in ${relative}, found ${markerCount}`,
    );
  }

  for (const replacement of replacements) {
    const originalCount = countOccurrences(source, replacement.original);
    const patchedCount = countOccurrences(source, replacement.patched);
    if (originalCount !== 0 || patchedCount !== 1) {
      fail(
        `patch verification failed for ${replacement.label} in ${relative}: ` +
          `original=${originalCount} patched=${patchedCount}`,
      );
    }
  }
}

if (!fs.existsSync(PACKAGE_JSON)) {
  fail(`${PACKAGE_NAME} is not installed: ${PACKAGE_JSON}`);
}

let packageJson;
try {
  packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
} catch (error) {
  fail(
    `cannot read ${PACKAGE_JSON}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

if (packageJson.version !== EXPECTED_VERSION) {
  fail(
    `unsupported ${PACKAGE_NAME} version ${JSON.stringify(packageJson.version)}; ` +
      `expected ${EXPECTED_VERSION}. Review and refresh this patch before upgrading.`,
  );
}

let patched = 0;
let already = 0;

for (const { file, replacements } of TARGETS) {
  const relative = path.relative(process.cwd(), file);

  if (!fs.existsSync(file)) {
    fail(`runtime bundle not found: ${relative}`);
  }

  let source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    fail(
      `cannot read ${relative}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (source.includes(MARKER)) {
    verifyPatchedSource(source, relative, replacements);
    already += 1;
    continue;
  }

  for (const replacement of replacements) {
    const occurrences = countOccurrences(source, replacement.original);
    if (occurrences !== 1) {
      fail(
        `expected exactly one ${replacement.label} fragment in ${relative}, ` +
          `found ${occurrences}. The minified xterm bundle may have changed.`,
      );
    }
    if (source.includes(replacement.patched)) {
      fail(`unexpected partial patch for ${replacement.label} in ${relative}`);
    }
  }

  let patchedSource = source;
  for (const replacement of replacements) {
    patchedSource = patchedSource.replace(
      replacement.original,
      replacement.patched,
    );
  }
  verifyPatchedSource(patchedSource, relative, replacements);

  try {
    writeFileAtomically(file, patchedSource);
  } catch (error) {
    fail(
      `cannot write ${relative}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  patched += 1;
}

console.log(
  `[patch-xterm-wide-char-selection] midpoint snapping: ` +
    `patched=${patched} already=${already} total=${TARGETS.length}`,
);
