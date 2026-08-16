import { describe, expect, it } from "vitest";
import { resolveTerminalRendererMode } from "./terminalRendererMode";

describe("resolveTerminalRendererMode", () => {
  it("keeps WebGL when hardware acceleration is on, even if the window is transparent", () => {
    // Transparency used to force "dom" here; that made release builds look like
    // hardware acceleration could not be enabled with acrylic/opacity < 1.
    expect(
      resolveTerminalRendererMode({
        preference: "webgl",
        webglCircuitBroken: false,
      }),
    ).toBe("webgl");
  });

  it("honors an explicit DOM preference", () => {
    expect(
      resolveTerminalRendererMode({
        preference: "dom",
        webglCircuitBroken: false,
      }),
    ).toBe("dom");
  });

  it("falls back to DOM after the WebGL circuit breaker trips", () => {
    expect(
      resolveTerminalRendererMode({
        preference: "webgl",
        webglCircuitBroken: true,
      }),
    ).toBe("dom");
  });
});
