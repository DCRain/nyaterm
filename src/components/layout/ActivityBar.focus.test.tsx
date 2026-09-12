import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ActivityBar from "./ActivityBar";

describe("ActivityBar settings interactions", () => {
  it("keeps the native drag path and mouse activation for settings", () => {
    const onSelect = vi.fn();
    renderActivityBar(onSelect);
    const button = screen.getByRole("button", { name: "Settings" });
    const mouseDown = createEvent.mouseDown(button, { button: 0 });
    const dataTransfer = {
      effectAllowed: "",
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent(button, mouseDown);
    fireEvent.dragStart(button, { dataTransfer });
    fireEvent.click(button);

    expect(button).toHaveProperty("draggable", true);
    expect(mouseDown.defaultPrevented).toBe(false);
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      "application/x-nyaterm-activity",
      JSON.stringify({ id: "settings", zone: "left_bottom" }),
    );
    expect(dataTransfer.effectAllowed).toBe("move");
    expect(onSelect).toHaveBeenCalledWith("settings");
  });

  it.each(["{Enter}", " "])("still supports keyboard activation with %s", async (key) => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderActivityBar(onSelect);
    const button = screen.getByRole("button", { name: "Settings" });
    button.focus();

    await user.keyboard(key);

    expect(document.activeElement).toBe(button);
    expect(onSelect).toHaveBeenCalledWith("settings");
  });
});

function renderActivityBar(onSelect: (id: string) => void) {
  render(
    <ActivityBar
      items={[]}
      bottomItems={[{ id: "settings", icon: null, tooltip: "Settings" }]}
      activeId={null}
      onSelect={onSelect}
      onReorder={vi.fn()}
      onMoveItem={vi.fn()}
      onHideItem={vi.fn()}
      onShowItem={vi.fn()}
      onToggleLabel={vi.fn()}
      onRequestResetLayout={vi.fn()}
      panelOpenMode="docked"
      onPanelOpenModeChange={vi.fn()}
      showLabels
      side="left"
      zone={{ top: "left_top", bottom: "left_bottom" }}
    />,
  );
}
