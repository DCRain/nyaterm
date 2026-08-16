import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RemoteFileConflictDialog from "./RemoteFileConflictDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("RemoteFileConflictDialog", () => {
  it("labels reloading as destructive to unsaved edits", () => {
    const onDiscardAndReload = vi.fn();

    render(
      <RemoteFileConflictDialog
        open
        onDiscardAndReload={onDiscardAndReload}
        onForceSave={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "fileEditor.discardAndReload" }));
    expect(onDiscardAndReload).toHaveBeenCalledOnce();
  });
});
