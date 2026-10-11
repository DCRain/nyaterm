import { describe, expect, it } from "vitest";
import {
  resolveFileEditorOpenTarget,
  resolveInternalEditorDisplay,
} from "./editorOpenMode";

describe("file editor open mode", () => {
  it("uses the browser editor without changing external desktop preferences", () => {
    const settings = { editor_type: "external", internal_editor_display: "window" } as const;
    expect(resolveFileEditorOpenTarget(settings, false)).toBe("internal-window");
    expect(resolveFileEditorOpenTarget({ editor_type: "external" }, false)).toBe("internal-workspace");
    expect(settings.editor_type).toBe("external");
  });
  it("uses the external editor when editor_type is external", () => {
    expect(
      resolveFileEditorOpenTarget({
        editor_type: "external",
        internal_editor_display: "window",
      }),
    ).toBe("external");
  });

  it("defaults internal editor to a child window", () => {
    expect(resolveFileEditorOpenTarget({ editor_type: "internal" })).toBe(
      "internal-window",
    );
    expect(resolveInternalEditorDisplay(undefined)).toBe("window");
  });

  it("opens internal editor in a workspace tab when configured", () => {
    expect(
      resolveFileEditorOpenTarget({
        editor_type: "internal",
        internal_editor_display: "workspace",
      }),
    ).toBe("internal-workspace");
    expect(resolveInternalEditorDisplay("workspace")).toBe("workspace");
  });

  it("opens internal editor in a child window when configured", () => {
    expect(
      resolveFileEditorOpenTarget({
        editor_type: "internal",
        internal_editor_display: "window",
      }),
    ).toBe("internal-window");
    expect(resolveInternalEditorDisplay("window")).toBe("window");
  });
});
