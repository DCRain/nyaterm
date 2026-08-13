import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VncForm } from "./VncForm";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/lib/invoke", () => ({ invoke: invokeMock }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function props() {
  return {
    host: "vnc.example.com",
    setHost: vi.fn(),
    port: 5900,
    setPort: vi.fn(),
    passwordId: "",
    setPasswordId: vi.fn(),
    password: "",
    setPassword: vi.fn(),
    hasPassword: false,
    setHasPassword: vi.fn(),
    scaleMode: "fit" as const,
    setScaleMode: vi.fn(),
    securityMode: "auto" as const,
    setSecurityMode: vi.fn(),
    shared: true,
    setShared: vi.fn(),
    viewOnly: false,
    setViewOnly: vi.fn(),
    clipboardEnabled: true,
    setClipboardEnabled: vi.fn(),
    reconnectEnabled: true,
    setReconnectEnabled: vi.fn(),
    reconnectMaxAttempts: 5,
    setReconnectMaxAttempts: vi.fn(),
  };
}

describe("VncForm", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([]);
  });

  it("uses the standard VNC port and explains the classic password limit", () => {
    render(<VncForm {...props()} />);

    expect(screen.getByDisplayValue("5900")).not.toBeNull();
    expect(screen.getByText("dialog.vncPasswordLimit")).not.toBeNull();
  });

  it("allows switching to saved password selection", () => {
    render(<VncForm {...props()} />);
    fireEvent.click(screen.getByText("dialog.savedPassword"));

    expect(invokeMock).toHaveBeenCalledWith("get_saved_passwords");
  });
});
