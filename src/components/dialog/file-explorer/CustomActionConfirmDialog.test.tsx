import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CustomActionConfirmDialog, {
  type CustomActionConfirmDialogData,
} from "./CustomActionConfirmDialog";

vi.mock("@/lib/invoke", () => ({
  invoke: vi.fn(),
}));

const baseData: CustomActionConfirmDialogData = {
  level: "warning",
  actionName: "Tail log",
  entryName: "app.log",
  fullPath: "/var/log/app.log",
  command: "tail -f -n 100 /var/log/app.log",
  execute: true,
  sessionId: "session-1",
  action: {
    id: "action-1",
    name: "Tail log",
    enabled: true,
    match_pattern: "*.log",
    target: "file",
    command: "tail -f -n 100 {path}",
    execute: true,
    confirmation_level: "warning",
  },
};

describe("CustomActionConfirmDialog", () => {
  it("runs onConfirm for warning level", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(<CustomActionConfirmDialog data={baseData} onClose={onClose} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "fileExplorer.customActionConfirm" }));

    expect(onConfirm).toHaveBeenCalledWith(baseData);
  });

  it("keeps danger confirm disabled until password is entered", () => {
    render(
      <CustomActionConfirmDialog
        data={{ ...baseData, level: "danger", action: { ...baseData.action, confirmation_level: "danger" } }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const confirmButton = screen.getByRole("button", {
      name: "fileExplorer.customActionConfirm",
    }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("fileExplorer.customActionDangerPassword"), {
      target: { value: "secret" },
    });

    expect(confirmButton.disabled).toBe(false);
  });
});
