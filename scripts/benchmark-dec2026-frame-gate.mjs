import { spawnSync } from "node:child_process";

const result = spawnSync(
  "pnpm",
  ["vitest", "run", "src/components/terminal/dec2026FrameGateBenchmark.test.ts", "--reporter", "verbose"],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

process.exitCode = result.status ?? 1;
