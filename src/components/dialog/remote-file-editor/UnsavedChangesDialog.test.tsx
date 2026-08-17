import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UnsavedChangesDialog from "./UnsavedChangesDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("UnsavedChangesDialog", () => {
  it("uses the responsive dialog footer instead of forcing long actions into three columns", () => {
    render(
      <UnsavedChangesDialog
        dirtyCount={1}
        hasPendingTab
        open
        saving={false}
        onDiscard={vi.fn()}
        onOpenChange={vi.fn()}
        onSaveAndClose={vi.fn()}
      />,
    );

    const content = document.querySelector('[data-slot="alert-dialog-content"]');
    const footer = document.querySelector('[data-slot="alert-dialog-footer"]');

    expect(content?.getAttribute("data-size")).toBe("default");
    expect(footer?.className).not.toContain(
      "group-data-[size=sm]/alert-dialog-content:grid-cols-3",
    );
  });
});
