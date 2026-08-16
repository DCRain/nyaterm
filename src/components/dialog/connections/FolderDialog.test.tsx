import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FolderDialog from "./FolderDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderFolderDialog(onSubmit: () => void, open = true) {
  return render(
    <FolderDialog
      open={open}
      isEditing={false}
      name="folder"
      onNameChange={vi.fn()}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
  );
}

describe("FolderDialog", () => {
  it("submits only once when Enter and Save happen in the same turn", () => {
    const onSubmit = vi.fn();
    renderFolderDialog(onSubmit);

    const input = screen.getByRole("textbox");
    const saveButton = screen.getByRole("button", { name: "dialog.save" });

    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.click(saveButton);
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
