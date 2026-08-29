import { describe, expect, it } from "vitest";
import { detectSystemLanguage, resolveAppLanguage } from "./systemLanguage";

describe("resolveAppLanguage", () => {
  it("maps common locale tags to supported app languages", () => {
    expect(resolveAppLanguage("zh-CN")).toBe("zh-CN");
    expect(resolveAppLanguage("zh_SG")).toBe("zh-CN");
    expect(resolveAppLanguage("zh-TW")).toBe("zh-TW");
    expect(resolveAppLanguage("zh-HK")).toBe("zh-TW");
    expect(resolveAppLanguage("ko-KR")).toBe("ko");
    expect(resolveAppLanguage("en-US")).toBe("en");
    expect(resolveAppLanguage("fr-FR")).toBe("en");
  });
});

describe("detectSystemLanguage", () => {
  it("returns a supported language id", () => {
    expect(["en", "zh-CN", "zh-TW", "ko"]).toContain(detectSystemLanguage());
  });
});
