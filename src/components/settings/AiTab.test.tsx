import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_SETTINGS } from "@/lib/aiSettings";
import type { AISettings } from "@/types/global";
import { AiModelsTab } from "./AiTab";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
let currentSettings: AISettings;
let appState: Record<string, unknown>;
vi.mock("@/context/AppContext", () => ({ useApp: () => appState }));
vi.mock("@/lib/invoke", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

function Harness({ initial }: { initial: AISettings }) {
  const [ai, setAi] = useState(initial);
  currentSettings = ai;
  appState = {
    appSettings: { ai },
    updateAppSettings: (
      patch: { ai: AISettings } | ((current: { ai: AISettings }) => { ai: AISettings }),
    ) => {
      setAi((current) => (typeof patch === "function" ? patch({ ai: current }).ai : patch.ai));
    },
  };
  return <AiModelsTab />;
}

function settingsWithProviders(): AISettings {
  const ai = structuredClone(DEFAULT_AI_SETTINGS);
  ai.provider_credentials = ai.provider_credentials.slice(0, 2).map((credential) => ({
    ...credential,
    enabled: true,
    api_key: "test-key",
  }));
  ai.models = [
    {
      id: "openai:test-model",
      name: "test-model",
      backend: "genai",
      provider_kind: "openai",
      credential_id: null,
      enabled: true,
      source: "rust-genai",
      last_seen_at: "2026-01-01T00:00:00Z",
      supported_reasoning_efforts: ["low"],
    },
  ];
  return ai;
}

describe("AI provider settings", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("keeps an empty account collapsed until the user adds a provider", () => {
    const initial = settingsWithProviders();
    initial.provider_credentials = [];
    initial.models = [];
    render(<Harness initial={initial} />);
    expect(screen.queryByText("ai.modelList")).toBeNull();
    expect(screen.queryByRole("button", { name: "OpenAI" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ai.addProvider" }));
    fireEvent.click(screen.getByRole("button", { name: "OpenAI" }));
    expect(currentSettings.provider_credentials.filter((item) => item.enabled)).toHaveLength(1);
    expect(screen.getByText("ai.modelList")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "ai.addProvider" }).getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("clears stale upstream badges while retaining model configuration", async () => {
    invokeMock.mockResolvedValue([]);
    render(<Harness initial={settingsWithProviders()} />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "ai.refreshModels" })),
    );
    expect(currentSettings.models[0]).toMatchObject({
      name: "test-model",
      enabled: true,
      last_seen_at: null,
      supported_reasoning_efforts: ["low"],
    });
  });

  it("gives a second account a unique name and keeps models bound to each account", () => {
    render(<Harness initial={settingsWithProviders()} />);
    fireEvent.click(screen.getByRole("button", { name: "ai.addProvider" }));
    fireEvent.click(screen.getByRole("button", { name: "OpenAI" }));
    const providers = currentSettings.provider_credentials.filter(
      (item) => item.provider_kind === "openai",
    );
    expect(providers.map((item) => item.name)).toEqual(["OpenAI-2", "OpenAI"]);
    expect(
      currentSettings.models.find((model) => model.id === "openai:test-model")?.credential_id,
    ).toBeNull();
    expect(currentSettings.models.some((model) => model.credential_id === providers[0].id)).toBe(
      true,
    );
  });

  it("hides both detail cards after deleting the last provider", () => {
    const initial = settingsWithProviders();
    initial.provider_credentials = initial.provider_credentials.slice(0, 1);
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "ai.deleteProvider" }));
    fireEvent.click(screen.getByRole("button", { name: "common.delete" }));
    expect(currentSettings.provider_credentials.filter((item) => item.enabled)).toHaveLength(0);
    expect(screen.queryByText("ai.modelList")).toBeNull();
    expect(screen.queryByRole("button", { name: "ai.connectionTest" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "ai.addProvider" }).getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("keeps model provenance on a failed refresh", async () => {
    invokeMock.mockRejectedValue(new Error("offline"));
    render(<Harness initial={settingsWithProviders()} />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "ai.refreshModels" })),
    );
    expect(currentSettings.models[0].last_seen_at).toBe("2026-01-01T00:00:00Z");
  });

  it("resets a pending test when switching providers and ignores its late result", async () => {
    let resolve!: (models: string[]) => void;
    invokeMock.mockReturnValue(
      new Promise<string[]>((done) => {
        resolve = done;
      }),
    );
    render(<Harness initial={settingsWithProviders()} />);
    fireEvent.click(screen.getByRole("button", { name: "ai.refreshModels" }));
    const openai = screen.getByRole("button", { name: /^OpenAI/ });
    expect(within(openai).getByLabelText("ai.connectionStatus.testing")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Anthropic/ }));
    expect(within(openai).getByLabelText("ai.connectionStatus.idle")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "ai.refreshModels" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    await act(async () => resolve(["late-model"]));
    expect(currentSettings.models.some((model) => model.name === "late-model")).toBe(false);
    expect(within(openai).getByLabelText("ai.connectionStatus.idle")).toBeTruthy();
  });
});
