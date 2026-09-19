import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { FileExplorerContextMenuActionBar } from "./FileExplorerEntryContextMenu";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "fileExplorer.cmCut": "Cut",
        "fileExplorer.cmCopy": "Copy",
        "fileExplorer.cmPaste": "Paste",
        "fileExplorer.cmRename": "Rename",
        "fileExplorer.cmDelete": "Delete",
      })[key] ?? key,
  }),
}));

describe("FileExplorerContextMenuActionBar", () => {
  it("renders five compact actions and keeps unavailable actions disabled", async () => {
    renderActionBar({ canCopy: true, canPaste: false });

    const items = await screen.findAllByRole("menuitem");
    expect(items).toHaveLength(5);
    expect(menuItem("Cut").hasAttribute("data-disabled")).toBe(true);
    expect(menuItem("Copy").hasAttribute("data-disabled")).toBe(false);
    expect(menuItem("Paste").hasAttribute("data-disabled")).toBe(true);
    expect(menuItem("Rename").hasAttribute("data-disabled")).toBe(true);
    expect(menuItem("Delete").hasAttribute("data-disabled")).toBe(true);
  });

  it("runs an enabled paste action", async () => {
    const onPaste = vi.fn();
    renderActionBar({ onPaste, canPaste: true });

    fireEvent.click(await screen.findByText("Paste"));

    expect(onPaste).toHaveBeenCalledOnce();
  });
});

function menuItem(label: string): HTMLElement {
  const item = screen.getByText(label).closest('[role="menuitem"]');
  if (!(item instanceof HTMLElement)) {
    throw new Error(`Missing menu item: ${label}`);
  }
  return item;
}

function renderActionBar(
  props: React.ComponentProps<typeof FileExplorerContextMenuActionBar>,
) {
  render(
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button type="button">Open menu</button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <FileExplorerContextMenuActionBar {...props} />
      </ContextMenuContent>
    </ContextMenu>,
  );

  fireEvent.contextMenu(screen.getByRole("button", { name: "Open menu" }));
}
