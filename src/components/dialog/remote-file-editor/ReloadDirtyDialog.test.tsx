import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ReloadDirtyDialog from "./ReloadDirtyDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("ReloadDirtyDialog", () => {
  it("uses the responsive dialog width for the long discard action", () => {
    render(<ReloadDirtyDialog open onConfirm={vi.fn()} onOpenChange={vi.fn()} />);

    const content = document.querySelector('[data-slot="alert-dialog-content"]');
    expect(content?.getAttribute("data-size")).toBe("default");
  });
});
