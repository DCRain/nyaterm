import { describe, expect, it } from "vitest";
import { ACRYLIC_THEME_ID, themes } from "./themes";

function hexLuminance(hex: string): number {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  if (!match) return 0;
  const [r, g, b] = match.slice(1).map((part) => {
    const channel = Number.parseInt(part, 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("Nya Acrylic theme", () => {
  it("is registered as a built-in theme with elevated chrome text", () => {
    const acrylic = themes[ACRYLIC_THEME_ID];
    const github = themes["github-dark"];
    expect(acrylic).toBeDefined();
    expect(acrylic?.name).toBe("Nya Acrylic");
    expect(hexLuminance(acrylic!.colors.textMuted)).toBeGreaterThan(
      hexLuminance(github!.colors.textMuted),
    );
    expect(hexLuminance(acrylic!.colors.textDimmed)).toBeGreaterThan(
      hexLuminance(github!.colors.textDimmed),
    );
    expect(hexLuminance(acrylic!.colors.text)).toBeGreaterThan(hexLuminance(github!.colors.text));
  });
});
