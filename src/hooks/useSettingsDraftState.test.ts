import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSettingsDraftState } from "./useSettingsDraftState";

type TestSettings = {
  value: string;
  ui: {
    width: number;
  };
};

describe("useSettingsDraftState", () => {
  it("marks dirty after a user edit", () => {
    const { result } = renderHook(({ committed }) => useSettingsDraftState(committed), {
      initialProps: { committed: settings("A") },
    });

    act(() => {
      result.current.updateDraftSettings({ value: "C" });
    });

    expect(result.current.draftSettings).toEqual(settings("C"));
    expect(result.current.isDirty).toBe(true);
  });

  it("follows external committed settings updates when untouched", () => {
    const { result, rerender } = renderHook(({ committed }) => useSettingsDraftState(committed), {
      initialProps: { committed: settings("A") },
    });

    rerender({ committed: settings("B", 2) });

    expect(result.current.draftSettings).toEqual(settings("B", 2));
    expect(result.current.isDirty).toBe(false);
  });

  it("keeps the draft when external committed settings update during a user edit", () => {
    const { result, rerender } = renderHook(({ committed }) => useSettingsDraftState(committed), {
      initialProps: { committed: settings("A") },
    });

    act(() => {
      result.current.updateDraftSettings({ value: "C" });
    });
    rerender({ committed: settings("B", 2) });

    expect(result.current.draftSettings).toEqual(settings("C"));
    expect(result.current.isDirty).toBe(true);
  });

  it("clears dirty after saved settings are accepted", () => {
    const { result } = renderHook(({ committed }) => useSettingsDraftState(committed), {
      initialProps: { committed: settings("A") },
    });

    act(() => {
      result.current.updateDraftSettings({ value: "C" });
    });
    act(() => {
      result.current.acceptSavedSettings(settings("C"));
    });

    expect(result.current.draftSettings).toEqual(settings("C"));
    expect(result.current.isDirty).toBe(false);
  });

  it("stays dirty when save fails and saved settings are not accepted", () => {
    const { result } = renderHook(({ committed }) => useSettingsDraftState(committed), {
      initialProps: { committed: settings("A") },
    });

    act(() => {
      result.current.updateDraftSettings({ value: "C" });
    });

    expect(result.current.draftSettings).toEqual(settings("C"));
    expect(result.current.isDirty).toBe(true);
  });

  it("discards changes back to the latest committed settings", () => {
    const { result, rerender } = renderHook(({ committed }) => useSettingsDraftState(committed), {
      initialProps: { committed: settings("A") },
    });

    act(() => {
      result.current.updateDraftSettings({ value: "C" });
    });
    rerender({ committed: settings("B", 2) });
    act(() => {
      result.current.discardDraftSettings();
    });

    expect(result.current.draftSettings).toEqual(settings("B", 2));
    expect(result.current.isDirty).toBe(false);
  });
});

function settings(value: string, width = 1): TestSettings {
  return {
    value,
    ui: {
      width,
    },
  };
}
