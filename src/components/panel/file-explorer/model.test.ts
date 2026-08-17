import { describe, expect, it } from "vitest";
import {
  buildMoveSuccessRefreshPlan,
  buildMoveOperations,
  buildMoveTargetPath,
  isMoveToSameDirectory,
} from "./model";

describe("file explorer move path helpers", () => {
  it("moves a single file to a target directory", () => {
    expect(buildMoveTargetPath("/data", "A.txt", "remote")).toBe(
      "/data/A.txt",
    );
  });

  it("moves a single directory to a target directory", () => {
    expect(buildMoveTargetPath("/data", "A", "remote")).toBe("/data/A");
  });

  it("builds operations for multiple files", () => {
    expect(
      buildMoveOperations(
        {
          backend: "remote",
          items: [
            { oldPath: "/home/A.txt", name: "A.txt", isDirectory: false },
            { oldPath: "/home/B.txt", name: "B.txt", isDirectory: false },
          ],
        },
        "/data",
      ),
    ).toEqual([
      {
        oldPath: "/home/A.txt",
        name: "A.txt",
        isDirectory: false,
        newPath: "/data/A.txt",
      },
      {
        oldPath: "/home/B.txt",
        name: "B.txt",
        isDirectory: false,
        newPath: "/data/B.txt",
      },
    ]);
  });

  it("builds operations for mixed files and folders", () => {
    expect(
      buildMoveOperations(
        {
          backend: "remote",
          items: [
            { oldPath: "/home/A", name: "A", isDirectory: true },
            {
              oldPath: "/home/config.yaml",
              name: "config.yaml",
              isDirectory: false,
            },
          ],
        },
        "/opt/backup",
      ).map((operation) => operation.newPath),
    ).toEqual(["/opt/backup/A", "/opt/backup/config.yaml"]);
  });

  it("preserves each entry basename automatically", () => {
    expect(
      buildMoveOperations(
        {
          backend: "remote",
          items: [
            { oldPath: "/home/user/.env", name: ".env", isDirectory: false },
          ],
        },
        "/tmp",
      )[0]?.newPath,
    ).toBe("/tmp/.env");
  });

  it("joins remote Unix paths without local separators", () => {
    expect(buildMoveTargetPath("/", "config.yaml", "remote")).toBe(
      "/config.yaml",
    );
    expect(buildMoveTargetPath("/opt/files/", "config.yaml", "remote")).toBe(
      "/opt/files/config.yaml",
    );
  });

  it("joins local Windows drive and UNC paths with Windows separators", () => {
    expect(buildMoveTargetPath("C:\\Users\\me", "config.yaml", "local")).toBe(
      "C:\\Users\\me\\config.yaml",
    );
    expect(
      buildMoveTargetPath("\\\\server\\share", "config.yaml", "local"),
    ).toBe("\\\\server\\share\\config.yaml");
  });

  it("detects same source and target directories", () => {
    expect(isMoveToSameDirectory("/home/user", "/home/user/", "remote")).toBe(
      true,
    );
    expect(isMoveToSameDirectory("C:\\Data", "c:\\data\\", "local")).toBe(
      true,
    );
    expect(isMoveToSameDirectory("/home/user", "/opt/backup", "remote")).toBe(
      false,
    );
  });

  it("plans selection cleanup and source/target refresh after move", () => {
    expect(
      buildMoveSuccessRefreshPlan("/home/user", "/opt/backup/", "remote"),
    ).toEqual({
      sourceDirectory: "/home/user",
      targetDirectory: "/opt/backup",
      shouldClearSelection: true,
    });
  });
});
