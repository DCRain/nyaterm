import { describe, expect, it } from "vitest";
import { parseTemporarySshLink } from "./temporaryLink";

describe("parseTemporarySshLink runtime mode", () => {
  it("defaults SSH URLs to standard mode", () => {
    const result = parseTemporarySshLink("ssh://root@example.com");

    expect(result.ok).toBe(true);
    if (result.ok && result.config.protocol === "ssh") {
      expect(result.config.runtime_mode).toBe("standard");
    }
  });

  it("accepts explicit standard mode", () => {
    const result = parseTemporarySshLink(
      "ssh://root@example.com?mode=standard",
    );

    expect(result.ok).toBe(true);
    if (result.ok && result.config.protocol === "ssh") {
      expect(result.config.runtime_mode).toBe("standard");
    }
  });

  it("accepts explicit terminal mode", () => {
    const result = parseTemporarySshLink(
      "ssh://root@example.com?mode=terminal",
    );

    expect(result.ok).toBe(true);
    if (result.ok && result.config.protocol === "ssh") {
      expect(result.config.runtime_mode).toBe("terminal");
    }
  });

  it("rejects invalid runtime mode values", () => {
    const result = parseTemporarySshLink("ssh://root@example.com?mode=foo");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorKey).toBe("temporarySsh.invalidMode");
    }
  });
});
