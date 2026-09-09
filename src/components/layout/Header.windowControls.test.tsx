import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { preventWindowControlMouseFocus } from "./Header";

const windowControls = ["minimize", "maximize", "close"];

describe("Header window control focus", () => {
  it.each(windowControls)("keeps content focus on %s mouse down", (control) => {
    const onClick = vi.fn();
    render(<WindowControlHarness control={control} onClick={onClick} />);
    const contentInput = screen.getByLabelText("content");
    const button = screen.getByRole("button", { name: control });
    contentInput.focus();
    const mouseDown = createEvent.mouseDown(button);

    fireEvent(button, mouseDown);
    fireEvent.click(button);

    expect(mouseDown.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(contentInput);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("still supports keyboard activation", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<WindowControlHarness control="minimize" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "minimize" });
    button.focus();

    await user.keyboard("{Enter}");

    expect(document.activeElement).toBe(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

function WindowControlHarness({
  control,
  onClick = vi.fn(),
}: {
  control: string;
  onClick?: () => void;
}) {
  return (
    <>
      <input aria-label="content" />
      <button
        type="button"
        aria-label={control}
        onMouseDown={preventWindowControlMouseFocus}
        onClick={onClick}
      />
    </>
  );
}
