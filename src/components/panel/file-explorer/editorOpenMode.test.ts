import { describe, expect, it } from "vitest";
import {
  resolveFileEditorOpenTarget,
  resolveInternalEditorDisplay,
} from "./editorOpenMode";

describe("file editor open mode", () => {
  it("uses the external editor when editor_type is external", () => {
    expect(
      resolveFileEditorOpenTarget({
        editor_type: "external",
        internal_editor_display: "window",
      }),
    ).toBe("external");
  });

  it("always opens the internal editor in its own window (workspace tab mode removed)", () => {
    expect(resolveFileEditorOpenTarget({ editor_type: "internal" })).toBe(
      "internal-window",
    );
    expect(resolveInternalEditorDisplay(undefined)).toBe("window");
  });

  it("normalizes a legacy persisted workspace value to window", () => {
    expect(
      resolveFileEditorOpenTarget({
        editor_type: "internal",
        internal_editor_display: "workspace",
      }),
    ).toBe("internal-window");
    expect(resolveInternalEditorDisplay("workspace")).toBe("window");
  });

  it("opens internal editor in a child window when configured", () => {
    expect(
      resolveFileEditorOpenTarget({
        editor_type: "internal",
        internal_editor_display: "window",
      }),
    ).toBe("internal-window");
  });
});
