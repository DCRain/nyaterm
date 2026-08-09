import { describe, expect, it } from "vitest";
import {
  defaultRdpRedirectSettings,
  normalizeRdpRedirectSettings,
  rdpRedirectSettingsFromSaved,
} from "./RdpForm";

describe("rdp redirect defaults", () => {
  it("enables clipboard and microphone by default", () => {
    const defaults = defaultRdpRedirectSettings();
    expect(defaults.redirectClipboard).toBe(true);
    expect(defaults.audioCapture).toBe(true);
    expect(defaults.redirectPrinters).toBe(false);
    expect(defaults.driveRedirectMode).toBe("all");
  });

  it("fills missing fields when normalizing patches", () => {
    const normalized = normalizeRdpRedirectSettings({ redirectPrinters: true });
    expect(normalized.redirectClipboard).toBe(true);
    expect(normalized.redirectPrinters).toBe(true);
    expect(normalized.audioCapture).toBe(true);
  });

  it("treats omitted backend true-fields as enabled when editing", () => {
    const fromSaved = rdpRedirectSettingsFromSaved({
      // redirect_clipboard / audio_capture intentionally omitted
      redirect_printers: false,
      drive_redirect: "*",
    });
    expect(fromSaved.redirectClipboard).toBe(true);
    expect(fromSaved.audioCapture).toBe(true);
    expect(fromSaved.driveRedirectMode).toBe("all");
  });

  it("preserves explicit false from saved connection", () => {
    const fromSaved = rdpRedirectSettingsFromSaved({
      redirect_clipboard: false,
      audio_capture: false,
    });
    expect(fromSaved.redirectClipboard).toBe(false);
    expect(fromSaved.audioCapture).toBe(false);
  });
});
