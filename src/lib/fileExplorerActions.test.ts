import { describe, expect, it } from "vitest";
import { buildTerminalCommandInput } from "@/lib/sessionInput";
import {
  createFileExplorerCustomAction,
  expandCommandTemplate,
  isFileExplorerActionSizeAllowed,
  matchesFileExplorerActionPattern,
  matchesFileExplorerActionTarget,
  matchFileExplorerActions,
  matchSimpleGlob,
  normalizeFileExplorerMatchPattern,
} from "./fileExplorerActions";

describe("fileExplorerActions matching", () => {
  it("creates empty defaults for new actions", () => {
    const action = createFileExplorerCustomAction();
    expect(action.name).toBe("");
    expect(action.match_pattern).toBe("");
    expect(action.command).toBe("");
    expect(action.target).toBe("file");
    expect(action.max_file_size_bytes).toBe(0);
  });

  it("enforces optional max file size for file targets", () => {
    expect(
      isFileExplorerActionSizeAllowed({ target: "file", max_file_size_bytes: 1024 }, 512),
    ).toBe(true);
    expect(
      isFileExplorerActionSizeAllowed({ target: "file", max_file_size_bytes: 1024 }, 2048),
    ).toBe(false);
    expect(
      isFileExplorerActionSizeAllowed({ target: "file", max_file_size_bytes: 0 }, 999999),
    ).toBe(true);
    expect(
      isFileExplorerActionSizeAllowed({ target: "directory", max_file_size_bytes: 1 }, 999999),
    ).toBe(true);
  });

  it("normalizes extension-only patterns to *.ext", () => {
    expect(normalizeFileExplorerMatchPattern(".log")).toBe("*.log");
    expect(normalizeFileExplorerMatchPattern("*.log")).toBe("*.log");
    expect(normalizeFileExplorerMatchPattern("logs")).toBe("logs");
  });

  it("matches simple globs and exact names", () => {
    expect(matchSimpleGlob("*.log", "app.log")).toBe(true);
    expect(matchSimpleGlob("app.?", "app.c")).toBe(true);
    expect(matchSimpleGlob("app.?", "app.cc")).toBe(false);
    expect(matchesFileExplorerActionPattern(".log", "nginx.log")).toBe(true);
    expect(matchesFileExplorerActionPattern("*.LOG", "App.Log")).toBe(true);
    expect(matchesFileExplorerActionPattern("logs", "logs")).toBe(true);
    expect(matchesFileExplorerActionPattern("logs", "log")).toBe(false);
  });

  it("matches any whitespace-separated pattern", () => {
    expect(matchesFileExplorerActionPattern("*.log *.out", "app.log")).toBe(true);
    expect(matchesFileExplorerActionPattern("*.log *.out", "trace.out")).toBe(true);
    expect(matchesFileExplorerActionPattern(".log .txt", "notes.txt")).toBe(true);
    expect(matchesFileExplorerActionPattern("*.log *.out", "readme.md")).toBe(false);
    expect(matchesFileExplorerActionPattern("logs tmp", "tmp")).toBe(true);
  });

  it("filters by target kind", () => {
    expect(matchesFileExplorerActionTarget("file", false)).toBe(true);
    expect(matchesFileExplorerActionTarget("file", true)).toBe(false);
    expect(matchesFileExplorerActionTarget("directory", true)).toBe(true);
    expect(matchesFileExplorerActionTarget("directory", false)).toBe(false);
    expect(matchesFileExplorerActionTarget("any", true)).toBe(false);
  });

  it("returns only enabled matching actions", () => {
    const actions = [
      createFileExplorerCustomAction({
        id: "1",
        name: "Tail",
        match_pattern: "*.log",
        target: "file",
        command: "tail -f {path}",
        enabled: true,
      }),
      createFileExplorerCustomAction({
        id: "2",
        name: "Disabled",
        match_pattern: "*.log",
        target: "file",
        command: "cat {path}",
        enabled: false,
      }),
      createFileExplorerCustomAction({
        id: "3",
        name: "Dir all",
        match_pattern: "",
        target: "directory",
        command: "cd {path}",
        enabled: true,
      }),
    ];

    expect(
      matchFileExplorerActions(actions, { name: "app.log", is_dir: false }).map((a) => a.id),
    ).toEqual(["1"]);
    expect(
      matchFileExplorerActions(actions, { name: "logs", is_dir: true }).map((a) => a.id),
    ).toEqual(["3"]);
    expect(
      matchFileExplorerActions(actions, { name: "other", is_dir: true }).map((a) => a.id),
    ).toEqual(["3"]);
  });
});

describe("fileExplorerActions templates", () => {
  it("expands placeholders with shell quoting for remote paths", () => {
    const expanded = expandCommandTemplate(
      "tail -f -n 100 {path}",
      { name: "app log.log" },
      {
        fullPath: "/var/log/app log.log",
        parentDir: "/var/log",
        backend: "remote",
      },
    );
    expect(expanded).toBe("tail -f -n 100 '/var/log/app log.log'");
  });

  it("expands name, dir, parentdir, and basename placeholders", () => {
    const expanded = expandCommandTemplate(
      "echo {name} {dir} {parentdir} {basename}",
      { name: "app.log" },
      {
        fullPath: "/var/log/app.log",
        parentDir: "/var/log",
        backend: "remote",
      },
    );
    expect(expanded).toBe("echo app.log /var/log /var/log app");
  });

  it("respects execute flag when building terminal input", () => {
    const command = expandCommandTemplate(
      "tail -f -n 100 {path}",
      { name: "app.log" },
      {
        fullPath: "/var/log/app.log",
        parentDir: "/var/log",
        backend: "remote",
      },
    );
    expect(buildTerminalCommandInput(command, true)).toBe("tail -f -n 100 /var/log/app.log\r");
    expect(buildTerminalCommandInput(command, false)).toBe("tail -f -n 100 /var/log/app.log");
  });
});
