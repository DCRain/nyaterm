export type TerminalRendererPreference = "dom" | "webgl" | "auto";
export type ResolvedTerminalRendererMode = "dom" | "webgl";

/**
 * Decide whether the terminal should use WebGL.
 *
 * IMPORTANT: Do NOT gate on window transparency / background image here.
 * That regression (transparent ⇒ always DOM) was fixed in 830b5202, then
 * accidentally reintroduced by 83b8ca71's helper. Transparent windows already
 * set xterm `allowTransparency` + transparent theme background; WebView2 GPU
 * blocklist is handled in `runtime.rs` via WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS.
 */
export function resolveTerminalRendererMode(options: {
  preference: TerminalRendererPreference;
  webglCircuitBroken: boolean;
}): ResolvedTerminalRendererMode {
  if (options.preference === "dom") return "dom";
  if (options.webglCircuitBroken) return "dom";
  if (options.preference === "webgl") return "webgl";

  return "dom";
}
