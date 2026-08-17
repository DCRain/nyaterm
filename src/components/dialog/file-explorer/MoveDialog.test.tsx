import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@/lib/invoke";
import MoveDialog, { type MoveDialogData } from "./MoveDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.count == null ? key : `${key}:${options.count}`,
  }),
}));

vi.mock("@/lib/invoke", () => ({ invoke: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const baseData: MoveDialogData = {
  sessionId: "session-1",
  backend: "local",
  sourceDirectory: "/home",
  initialTargetDirectory: "/home",
  items: [
    {
      oldPath: "/home/A.txt",
      name: "A.txt",
      isDirectory: false,
    },
  ],
};

describe("MoveDialog", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("moves a single item to the entered target directory", async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <MoveDialog data={baseData} onClose={onClose} onSuccess={onSuccess} />,
    );

    fireEvent.change(screen.getByLabelText("fileExplorer.targetDirectory"), {
      target: { value: "/data" },
    });
    fireEvent.click(screen.getByRole("button", { name: "fileExplorer.cmMove" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("rename_local_file", {
        sessionId: "session-1",
        oldPath: "/home/A.txt",
        newPath: "/data/A.txt",
      });
    });
    expect(onSuccess).toHaveBeenCalledWith("/data");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("moves multiple remote items and preserves old raw path tokens", async () => {
    const data: MoveDialogData = {
      sessionId: "session-1",
      backend: "remote",
      sourceDirectory: "/home",
      initialTargetDirectory: "/home",
      items: [
        {
          oldPath: "/home/A",
          oldRawPathToken: "raw-a",
          name: "A",
          isDirectory: true,
        },
        {
          oldPath: "/home/C.txt",
          oldRawPathToken: "raw-c",
          name: "C.txt",
          isDirectory: false,
        },
      ],
    };

    render(<MoveDialog data={data} onClose={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("fileExplorer.targetDirectory"), {
      target: { value: "/opt/files" },
    });
    fireEvent.click(screen.getByRole("button", { name: "fileExplorer.cmMove" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(2);
    });
    expect(invoke).toHaveBeenNthCalledWith(1, "rename_remote_file", {
      sessionId: "session-1",
      oldPath: "/home/A",
      newPath: "/opt/files/A",
      oldRawPathToken: "raw-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "rename_remote_file", {
      sessionId: "session-1",
      oldPath: "/home/C.txt",
      newPath: "/opt/files/C.txt",
      oldRawPathToken: "raw-c",
    });
  });

  it("keeps batch state understandable when one move fails", async () => {
    const { toast } = await import("sonner");
    vi.mocked(invoke)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("permission denied"));
    const onSuccess = vi.fn();

    render(
      <MoveDialog
        data={{
          ...baseData,
          items: [
            {
              oldPath: "/home/A.txt",
              name: "A.txt",
              isDirectory: false,
            },
            {
              oldPath: "/home/B.txt",
              name: "B.txt",
              isDirectory: false,
            },
          ],
        }}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByLabelText("fileExplorer.targetDirectory"), {
      target: { value: "/data" },
    });
    fireEvent.click(screen.getByRole("button", { name: "fileExplorer.cmMove" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(2);
    });
    expect(onSuccess).toHaveBeenCalledWith("/data");
    expect(toast.error).toHaveBeenCalledWith("fileExplorer.moveFailedItem");
  });
});
