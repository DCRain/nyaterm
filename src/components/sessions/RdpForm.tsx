import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdChevronRight, MdClose } from "react-icons/md";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SessionNetworkSection } from "@/components/sessions/SessionNetworkSection";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { invoke } from "@/lib/invoke";
import { listRemoteDesktopClients, type RemoteDesktopClientInfo } from "@/lib/remoteDesktop";
import type {
  ProxyConfig,
  RdpCertificatePolicy,
  RdpClipboardMode,
  RdpDisplayMode,
  SavedPassword,
} from "@/types/global";
import type { ConnectionOption } from "@/components/network/shared";

export type RdpExternalDisplayMode = "fullscreen" | "windowed";
export type RdpResolutionPreset =
  | "3840x2160"
  | "2560x1440"
  | "2560x1600"
  | "2048x1152"
  | "1920x1200"
  | "1920x1080"
  | "1600x900"
  | "1280x720"
  | "custom";

export type RdpDriveRedirectMode = "all" | "off" | "custom";
export type RdpStarOrOff = "all" | "off";

export interface RdpRedirectSettings {
  redirectClipboard: boolean;
  redirectPrinters: boolean;
  redirectComPorts: boolean;
  redirectSmartCards: boolean;
  driveRedirectMode: RdpDriveRedirectMode;
  driveRedirectCustom: string;
  deviceRedirect: RdpStarOrOff;
  cameraRedirect: RdpStarOrOff;
  audioMode: number;
  audioCapture: boolean;
  keyboardHook: number;
}

interface RdpFormProps {
  host: string;
  setHost: (value: string) => void;
  port: number;
  setPort: (value: number) => void;
  username: string;
  setUsername: (value: string) => void;
  domain: string;
  setDomain: (value: string) => void;
  clientMode: "external" | "builtin";
  setClientMode: (value: "external" | "builtin") => void;
  passwordId: string;
  setPasswordId: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  hasPassword: boolean;
  setHasPassword: (value: boolean) => void;
  useNla: boolean;
  setUseNla: (value: boolean) => void;
  certificatePolicy: RdpCertificatePolicy;
  setCertificatePolicy: (value: RdpCertificatePolicy) => void;
  displayWidth: number;
  setDisplayWidth: (value: number) => void;
  displayHeight: number;
  setDisplayHeight: (value: number) => void;
  displayMode: RdpDisplayMode;
  setDisplayMode: (value: RdpDisplayMode) => void;
  clipboardMode: RdpClipboardMode;
  setClipboardMode: (value: RdpClipboardMode) => void;
  reconnectEnabled: boolean;
  setReconnectEnabled: (value: boolean) => void;
  reconnectMaxAttempts: number;
  setReconnectMaxAttempts: (value: number) => void;
  externalDisplayMode: RdpExternalDisplayMode;
  setExternalDisplayMode: (value: RdpExternalDisplayMode) => void;
  resolutionPreset: RdpResolutionPreset;
  setResolutionPreset: (value: RdpResolutionPreset) => void;
  width: number;
  setWidth: (value: number) => void;
  height: number;
  setHeight: (value: number) => void;
  preferredClient: string;
  setPreferredClient: (value: string) => void;
  redirects: RdpRedirectSettings;
  setRedirects: (patch: Partial<RdpRedirectSettings>) => void;
  proxyId: string;
  setProxyId: (value: string) => void;
  proxies: ProxyConfig[];
  jumpHostId: string;
  setJumpHostId: (value: string) => void;
  jumpHostOptions: ConnectionOption[];
  connectionId?: string;
}

type PasswordSource = "direct" | "saved";

const MASKED_PASSWORD_PLACEHOLDER = "********";

function RequiredMark() {
  return <span className="ml-0.5 text-destructive">*</span>;
}

const RESOLUTION_PRESETS: Array<{ value: RdpResolutionPreset; width: number; height: number }> = [
  { value: "3840x2160", width: 3840, height: 2160 },
  { value: "2560x1440", width: 2560, height: 1440 },
  { value: "2560x1600", width: 2560, height: 1600 },
  { value: "2048x1152", width: 2048, height: 1152 },
  { value: "1920x1200", width: 1920, height: 1200 },
  { value: "1920x1080", width: 1920, height: 1080 },
  { value: "1600x900", width: 1600, height: 900 },
  { value: "1280x720", width: 1280, height: 720 },
];

export const DEFAULT_RDP_WIDTH = 1920;
export const DEFAULT_RDP_HEIGHT = 1080;
export const DEFAULT_RDP_USERNAME = "administrator";

export function resolveRdpResolutionPreset(width: number, height: number): RdpResolutionPreset {
  const w = width > 0 ? width : DEFAULT_RDP_WIDTH;
  const h = height > 0 ? height : DEFAULT_RDP_HEIGHT;
  const match = RESOLUTION_PRESETS.find((preset) => preset.width === w && preset.height === h);
  return match?.value ?? "custom";
}

export function normalizeRdpSize(width: number, height: number): { width: number; height: number } {
  return {
    width: width > 0 ? width : DEFAULT_RDP_WIDTH,
    height: height > 0 ? height : DEFAULT_RDP_HEIGHT,
  };
}

export function driveRedirectFromStored(value: string | undefined): {
  mode: RdpDriveRedirectMode;
  custom: string;
} {
  const trimmed = (value ?? "*").trim();
  if (trimmed === "*") return { mode: "all", custom: "" };
  if (!trimmed) return { mode: "off", custom: "" };
  return { mode: "custom", custom: trimmed };
}

export function driveRedirectToStored(mode: RdpDriveRedirectMode, custom: string): string {
  if (mode === "all") return "*";
  if (mode === "off") return "";
  return custom.trim();
}

export function starOrOffFromStored(value: string | undefined): RdpStarOrOff {
  return (value ?? "").trim() === "*" ? "all" : "off";
}

export function starOrOffToStored(value: RdpStarOrOff): string {
  return value === "all" ? "*" : "";
}

export function defaultRdpRedirectSettings(): RdpRedirectSettings {
  return {
    redirectClipboard: true,
    redirectPrinters: false,
    redirectComPorts: false,
    redirectSmartCards: false,
    driveRedirectMode: "all",
    driveRedirectCustom: "",
    deviceRedirect: "off",
    cameraRedirect: "off",
    audioMode: 0,
    audioCapture: true,
    keyboardHook: 2,
  };
}

/** Merge partial/stored values onto defaults so switches never get `undefined` checked state. */
export function normalizeRdpRedirectSettings(
  partial?: Partial<RdpRedirectSettings> | null,
): RdpRedirectSettings {
  return { ...defaultRdpRedirectSettings(), ...partial };
}

export function rdpRedirectSettingsFromSaved(connection: {
  redirect_clipboard?: boolean;
  redirect_printers?: boolean;
  redirect_com_ports?: boolean;
  redirect_smart_cards?: boolean;
  drive_redirect?: string;
  device_redirect?: string;
  camera_redirect?: string;
  audio_mode?: number;
  audio_capture?: boolean;
  keyboard_hook?: number;
}): RdpRedirectSettings {
  const drive = driveRedirectFromStored(connection.drive_redirect);
  return normalizeRdpRedirectSettings({
    redirectClipboard: connection.redirect_clipboard ?? true,
    redirectPrinters: connection.redirect_printers ?? false,
    redirectComPorts: connection.redirect_com_ports ?? false,
    redirectSmartCards: connection.redirect_smart_cards ?? false,
    driveRedirectMode: drive.mode,
    driveRedirectCustom: drive.custom,
    deviceRedirect: starOrOffFromStored(connection.device_redirect),
    cameraRedirect: starOrOffFromStored(connection.camera_redirect),
    audioMode: connection.audio_mode ?? 0,
    audioCapture: connection.audio_capture ?? true,
    keyboardHook: connection.keyboard_hook ?? 2,
  });
}

export function RdpForm({
  host,
  setHost,
  port,
  setPort,
  username,
  setUsername,
  domain,
  setDomain,
  clientMode,
  setClientMode,
  passwordId,
  setPasswordId,
  password,
  setPassword,
  hasPassword,
  setHasPassword,
  useNla,
  setUseNla,
  certificatePolicy,
  setCertificatePolicy,
  displayWidth,
  setDisplayWidth,
  displayHeight,
  setDisplayHeight,
  displayMode,
  setDisplayMode,
  clipboardMode,
  setClipboardMode,
  reconnectEnabled,
  setReconnectEnabled,
  reconnectMaxAttempts,
  setReconnectMaxAttempts,
  externalDisplayMode,
  setExternalDisplayMode,
  resolutionPreset,
  setResolutionPreset,
  width,
  setWidth,
  height,
  setHeight,
  preferredClient,
  setPreferredClient,
  redirects,
  setRedirects,
  proxyId,
  setProxyId,
  proxies,
  jumpHostId,
  setJumpHostId,
  jumpHostOptions,
  connectionId,
}: RdpFormProps) {
  const { t } = useTranslation();
  const [passwords, setPasswords] = useState<SavedPassword[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [redirectsOpen, setRedirectsOpen] = useState(true);
  const [clients, setClients] = useState<RemoteDesktopClientInfo[]>([]);
  const [passwordSource, setPasswordSource] = useState<PasswordSource>(
    passwordId ? "saved" : "direct",
  );

  useEffect(() => {
    invoke<SavedPassword[]>("get_saved_passwords")
      .then((items) => {
        setPasswords(items);
        if (passwordId && !items.some((item) => item.id === passwordId)) {
          setPasswordId("");
        }
      })
      .catch(() => {});
  }, [passwordId, setPasswordId]);

  useEffect(() => {
    setPasswordSource(passwordId ? "saved" : "direct");
  }, [passwordId]);

  const selectedPasswordName = passwords.find((item) => item.id === passwordId)?.name;
  const normalizedDisplayMode = displayMode === "native" ? "fixed" : displayMode;
  const fixedDisplay = normalizedDisplayMode === "fixed";

  const togglePasswordVisibility = async () => {
    if (showPassword) {
      setShowPassword(false);
      return;
    }

    if (!password && hasPassword && connectionId) {
      setPasswordLoading(true);
      try {
        const value = await invoke<string | null>("get_connection_password_value", {
          id: connectionId,
        });
        if (value) {
          setPassword(value);
          setHasPassword(false);
        }
      } catch {
        return;
      } finally {
        setPasswordLoading(false);
      }
    }

    setShowPassword(true);
  };

  useEffect(() => {
    if (clientMode !== "external") {
      return;
    }

    let cancelled = false;
    void listRemoteDesktopClients("rdp")
      .then((list) => {
        if (!cancelled) setClients(list);
      })
      .catch(() => {
        if (!cancelled) setClients([]);
      });
    return () => {
      cancelled = true;
    };
  }, [clientMode]);

  const handlePresetChange = (value: RdpResolutionPreset) => {
    setResolutionPreset(value);
    if (value === "custom") {
      if (width <= 0) setWidth(DEFAULT_RDP_WIDTH);
      if (height <= 0) setHeight(DEFAULT_RDP_HEIGHT);
      return;
    }
    const preset = RESOLUTION_PRESETS.find((item) => item.value === value);
    if (preset) {
      setWidth(preset.width);
      setHeight(preset.height);
    }
  };

  const clientSelectValue = preferredClient.trim() || "auto";

  return (
    <div className="space-y-3 w-full">
      <div>
        <Label className="text-xs font-medium text-foreground/80">
          {t("dialog.rdpClientMode", "Connection mode")}
        </Label>
        <Select
          value={clientMode}
          onValueChange={(value) => setClientMode(value as "external" | "builtin")}
        >
          <SelectTrigger className="mt-1 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="external" className="text-xs">
              {t("dialog.rdpClientExternal", "External client")}
            </SelectItem>
            <SelectItem value="builtin" className="text-xs">
              {t("dialog.rdpClientBuiltin", "Built-in (IronRDP)")}
            </SelectItem>
          </SelectContent>
        </Select>
        {clientMode === "builtin" ? (
          <p className="mt-1.5 text-[0.6875rem] leading-snug text-muted-foreground">
            {t(
              "dialog.rdpClientBuiltinDesc",
              "Connect inside NyaTerm with password, certificate, and display options.",
            )}
          </p>
        ) : (
          <p className="mt-1.5 text-[0.6875rem] leading-snug text-muted-foreground">
            {t(
              "dialog.rdpExternalHint",
              "Opens an external RDP client (such as mstsc or FreeRDP). Passwords are entered in the client.",
            )}
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <div>
          <Label className="text-xs font-medium text-foreground/80">
            {t("dialog.host")}
            <RequiredMark />
          </Label>
          <Input
            className="mt-1 h-8 text-xs"
            placeholder="192.168.1.100"
            value={host}
            onChange={(event) => setHost(event.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs font-medium text-foreground/80">
            {t("dialog.port")}
            <RequiredMark />
          </Label>
          <NumberInput
            className="mt-1 [&_button]:h-8 [&_button]:w-8 [&_input]:h-8 [&_input]:text-xs"
            value={port}
            onChange={setPort}
            min={1}
            max={65535}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs font-medium text-foreground/80">
            {t("dialog.username")}
            {clientMode === "builtin" ? <RequiredMark /> : null}
          </Label>
          <Input
            className="mt-1 h-8 text-xs"
            value={username}
            placeholder={
              clientMode === "external" ? DEFAULT_RDP_USERNAME : t("dialog.rdpUsernamePlaceholder")
            }
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs font-medium text-foreground/80">{t("dialog.rdpDomain")}</Label>
          <Input
            className="mt-1 h-8 text-xs"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          />
        </div>
      </div>

      {clientMode === "builtin" ? (
        <div>
          <Label className="text-xs font-medium text-foreground/80">
            {t("dialog.authentication")}
          </Label>
          <Tabs
            value={passwordSource}
            onValueChange={(value) => {
              const nextSource = value as PasswordSource;
              setPasswordSource(nextSource);
              if (nextSource === "direct") {
                setPasswordId("");
              } else {
                setPassword("");
                setHasPassword(false);
                setShowPassword(false);
              }
            }}
            className="mt-1 w-full"
          >
            <TabsList className="grid h-8 w-full grid-cols-2 pointer-events-auto">
              <TabsTrigger value="direct" className="text-xs">
                {t("dialog.directPassword")}
              </TabsTrigger>
              <TabsTrigger value="saved" className="text-xs">
                {t("dialog.savedPassword")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="direct" className="mt-3 border-0 outline-none">
              <Label className="text-xs font-medium text-foreground/80">{t("dialog.password")}</Label>
              <div className="relative mt-1">
                <Input
                  className="h-8 pr-16 text-xs"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  placeholder={
                    hasPassword && !password
                      ? MASKED_PASSWORD_PLACEHOLDER
                      : t("dialog.passwordPlaceholder")
                  }
                  disabled={passwordLoading}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setPasswordId("");
                    if (event.target.value) {
                      setHasPassword(false);
                    }
                  }}
                />
                {(password || hasPassword) && (
                  <button
                    type="button"
                    className="absolute right-7 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    title={showPassword ? t("dialog.hidePassword") : t("dialog.showPassword")}
                    disabled={passwordLoading}
                    onClick={() => {
                      void togglePasswordVisibility();
                    }}
                  >
                    {showPassword ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                {(password || hasPassword) && (
                  <button
                    type="button"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                    title={t("dialog.clearPassword", "Clear password")}
                    onClick={() => {
                      setPassword("");
                      setHasPassword(false);
                      setShowPassword(false);
                    }}
                  >
                    <MdClose className="text-sm" />
                  </button>
                )}
              </div>
            </TabsContent>

            <TabsContent value="saved" className="mt-3 border-0 outline-none">
              <Label className="text-xs font-medium text-foreground/80">
                {t("dialog.savedPassword")}
              </Label>
              <Select
                value={passwordId || "__none__"}
                onValueChange={(value) => {
                  setPasswordId(value === "__none__" ? "" : value);
                  setPassword("");
                  setHasPassword(false);
                  setShowPassword(false);
                }}
              >
                <SelectTrigger className="mt-1 h-8 w-full text-xs font-normal">
                  <SelectValue placeholder={t("dialog.selectPassword")}>
                    {selectedPasswordName || t("dialog.none")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("dialog.none")}</SelectItem>
                  {passwords.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TabsContent>
          </Tabs>
        </div>
      ) : null}

      {clientMode === "external" ? (
        <>
          <div>
            <Label className="text-xs font-medium text-foreground/80">
              {t("dialog.rdpClient", "RDP client")}
            </Label>
            <Select
              value={clientSelectValue}
              onValueChange={(value) => setPreferredClient(value === "auto" ? "" : value)}
            >
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto" className="text-xs">
                  {t("dialog.rdpClientAuto", "Automatic (recommended)")}
                </SelectItem>
                {preferredClient.trim() &&
                !clients.some((client) => client.id === preferredClient.trim()) ? (
                  <SelectItem value={preferredClient.trim()} className="text-xs">
                    {`${preferredClient.trim()} (${t("dialog.rdpClientNotInstalled", "not installed")})`}
                  </SelectItem>
                ) : null}
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id} className="text-xs">
                    {client.available
                      ? client.name
                      : `${client.name} (${t("dialog.rdpClientNotInstalled", "not installed")})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {externalDisplayMode === "windowed" ? (
              <p className="mt-1.5 text-[0.6875rem] leading-snug text-muted-foreground">
                {t(
                  "dialog.rdpDynamicResolutionHint",
                  "Windowed mode writes dynamic resolution. Windows App and FreeRDP can resize the remote desktop with the window; mstsc usually keeps a fixed resolution and may show scrollbars.",
                )}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs font-medium text-foreground/80">
                {t("dialog.rdpDisplayMode", "Display mode")}
              </Label>
              <Select
                value={externalDisplayMode}
                onValueChange={(value) => setExternalDisplayMode(value as RdpExternalDisplayMode)}
              >
                <SelectTrigger className="mt-1 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fullscreen" className="text-xs">
                    {t("dialog.rdpFullscreen", "Fullscreen")}
                  </SelectItem>
                  <SelectItem value="windowed" className="text-xs">
                    {t("dialog.rdpWindowed", "Windowed")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium text-foreground/80">
                {t("dialog.rdpResolution", "Resolution")}
              </Label>
              <Select
                value={resolutionPreset}
                onValueChange={(value) => handlePresetChange(value as RdpResolutionPreset)}
              >
                <SelectTrigger className="mt-1 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3840x2160" className="text-xs">
                    3840×2160 (4K)
                  </SelectItem>
                  <SelectItem value="2560x1440" className="text-xs">
                    2560×1440 (2K)
                  </SelectItem>
                  <SelectItem value="2560x1600" className="text-xs">
                    2560×1600
                  </SelectItem>
                  <SelectItem value="2048x1152" className="text-xs">
                    2048×1152
                  </SelectItem>
                  <SelectItem value="1920x1200" className="text-xs">
                    1920×1200
                  </SelectItem>
                  <SelectItem value="1920x1080" className="text-xs">
                    1920×1080
                  </SelectItem>
                  <SelectItem value="1600x900" className="text-xs">
                    1600×900
                  </SelectItem>
                  <SelectItem value="1280x720" className="text-xs">
                    1280×720
                  </SelectItem>
                  <SelectItem value="custom" className="text-xs">
                    {t("dialog.rdpResolutionCustom", "Custom")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {resolutionPreset === "custom" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium text-foreground/80">
                  {t("dialog.rdpWidth", "Width")}
                </Label>
                <NumberInput
                  className="mt-1 [&_button]:h-8 [&_button]:w-8 [&_input]:h-8 [&_input]:text-xs"
                  value={width || DEFAULT_RDP_WIDTH}
                  min={640}
                  max={8192}
                  onChange={(value) => setWidth(Math.max(0, value))}
                />
              </div>
              <div>
                <Label className="text-xs font-medium text-foreground/80">
                  {t("dialog.rdpHeight", "Height")}
                </Label>
                <NumberInput
                  className="mt-1 [&_button]:h-8 [&_button]:w-8 [&_input]:h-8 [&_input]:text-xs"
                  value={height || DEFAULT_RDP_HEIGHT}
                  min={480}
                  max={8192}
                  onChange={(value) => setHeight(Math.max(0, value))}
                />
              </div>
            </div>
          ) : null}

          <Collapsible open={redirectsOpen} onOpenChange={setRedirectsOpen}>
            <CollapsibleTrigger className="group flex w-full items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
              <MdChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
              {t("dialog.rdpRedirectSection", "Redirection & devices")}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <SwitchRow
                  label={t("dialog.rdpClipboard", "Clipboard")}
                  checked={redirects.redirectClipboard}
                  onCheckedChange={(checked) => setRedirects({ redirectClipboard: checked })}
                />
                <SwitchRow
                  label={t("dialog.rdpPrinters", "Printers")}
                  checked={redirects.redirectPrinters}
                  onCheckedChange={(checked) => setRedirects({ redirectPrinters: checked })}
                />
                <SwitchRow
                  label={t("dialog.rdpComPorts", "COM ports")}
                  checked={redirects.redirectComPorts}
                  onCheckedChange={(checked) => setRedirects({ redirectComPorts: checked })}
                />
                <SwitchRow
                  label={t("dialog.rdpSmartCards", "Smart cards")}
                  checked={redirects.redirectSmartCards}
                  onCheckedChange={(checked) => setRedirects({ redirectSmartCards: checked })}
                />
                <SwitchRow
                  label={t("dialog.rdpMicrophone", "Microphone")}
                  checked={redirects.audioCapture}
                  onCheckedChange={(checked) => setRedirects({ audioCapture: checked })}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs font-medium text-foreground/80">
                    {t("dialog.rdpAudioMode", "Audio output")}
                  </Label>
                  <Select
                    value={String(redirects.audioMode)}
                    onValueChange={(value) => setRedirects({ audioMode: Number(value) })}
                  >
                    <SelectTrigger className="mt-1 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0" className="text-xs">
                        {t("dialog.rdpAudioLocal", "Play on this computer")}
                      </SelectItem>
                      <SelectItem value="1" className="text-xs">
                        {t("dialog.rdpAudioRemote", "Play on remote computer")}
                      </SelectItem>
                      <SelectItem value="2" className="text-xs">
                        {t("dialog.rdpAudioOff", "Do not play")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-medium text-foreground/80">
                    {t("dialog.rdpKeyboardHook", "Windows keys")}
                  </Label>
                  <Select
                    value={String(redirects.keyboardHook)}
                    onValueChange={(value) => setRedirects({ keyboardHook: Number(value) })}
                  >
                    <SelectTrigger className="mt-1 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0" className="text-xs">
                        {t("dialog.rdpKeyboardLocal", "On this computer")}
                      </SelectItem>
                      <SelectItem value="1" className="text-xs">
                        {t("dialog.rdpKeyboardRemote", "On the remote computer")}
                      </SelectItem>
                      <SelectItem value="2" className="text-xs">
                        {t("dialog.rdpKeyboardFullscreen", "Only when fullscreen")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs font-medium text-foreground/80">
                    {t("dialog.rdpDrives", "Drive redirection")}
                  </Label>
                  <Select
                    value={redirects.driveRedirectMode}
                    onValueChange={(value) =>
                      setRedirects({ driveRedirectMode: value as RdpDriveRedirectMode })
                    }
                  >
                    <SelectTrigger className="mt-1 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">
                        {t("dialog.rdpRedirectAll", "All drives")}
                      </SelectItem>
                      <SelectItem value="off" className="text-xs">
                        {t("dialog.rdpRedirectOff", "Off")}
                      </SelectItem>
                      <SelectItem value="custom" className="text-xs">
                        {t("dialog.rdpRedirectCustom", "Custom")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {redirects.driveRedirectMode === "custom" ? (
                    <Input
                      className="mt-2 h-8 text-xs"
                      value={redirects.driveRedirectCustom}
                      placeholder="C:;D:;"
                      onChange={(event) =>
                        setRedirects({ driveRedirectCustom: event.target.value })
                      }
                    />
                  ) : null}
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-medium text-foreground/80">
                      {t("dialog.rdpDevices", "PnP devices")}
                    </Label>
                    <Select
                      value={redirects.deviceRedirect}
                      onValueChange={(value) =>
                        setRedirects({ deviceRedirect: value as RdpStarOrOff })
                      }
                    >
                      <SelectTrigger className="mt-1 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">
                          {t("dialog.rdpRedirectAll", "All")}
                        </SelectItem>
                        <SelectItem value="off" className="text-xs">
                          {t("dialog.rdpRedirectOff", "Off")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-foreground/80">
                      {t("dialog.rdpCameras", "Cameras")}
                    </Label>
                    <Select
                      value={redirects.cameraRedirect}
                      onValueChange={(value) =>
                        setRedirects({ cameraRedirect: value as RdpStarOrOff })
                      }
                    >
                      <SelectTrigger className="mt-1 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">
                          {t("dialog.rdpRedirectAll", "All")}
                        </SelectItem>
                        <SelectItem value="off" className="text-xs">
                          {t("dialog.rdpRedirectOff", "Off")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </>
      ) : null}

      {clientMode === "builtin" ? (
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger className="group flex w-full items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <MdChevronRight
              className={`text-sm transition-transform duration-200 ${advancedOpen ? "rotate-90" : ""}`}
            />
            <span>{t("dialog.advancedConfig")}</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <Tabs defaultValue="security" className="w-full">
              <TabsList className="grid h-8 w-full grid-cols-5 pointer-events-auto">
                <TabsTrigger value="security" className="text-xs">
                  {t("dialog.rdpSecurity")}
                </TabsTrigger>
                <TabsTrigger value="network" className="text-xs">
                  {t("dialog.proxySelect")}
                </TabsTrigger>
                <TabsTrigger value="display" className="text-xs">
                  {t("dialog.rdpDisplay")}
                </TabsTrigger>
                <TabsTrigger value="clipboard" className="text-xs">
                  {t("dialog.rdpClipboard")}
                </TabsTrigger>
                <TabsTrigger value="reconnect" className="text-xs">
                  {t("dialog.rdpReconnect")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="security" className="mt-3 border-0 outline-none">
                <div className="rounded-lg border bg-accent/25 p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border bg-background/70 px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-0.5">
                          <div className="text-xs font-medium">{t("dialog.rdpUseNla")}</div>
                          <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
                            {t("dialog.rdpUseNlaDesc")}
                          </p>
                        </div>
                        <Switch checked={useNla} onCheckedChange={setUseNla} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-foreground/80">
                        {t("dialog.rdpCertificatePolicy")}
                      </Label>
                      <Select
                        value={certificatePolicy}
                        onValueChange={(value) =>
                          setCertificatePolicy(value as RdpCertificatePolicy)
                        }
                      >
                        <SelectTrigger className="mt-1 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="prompt">{t("dialog.rdpCertificatePrompt")}</SelectItem>
                          <SelectItem value="strict">{t("dialog.rdpCertificateStrict")}</SelectItem>
                          <SelectItem value="accept-temporarily">
                            {t("dialog.rdpCertificateTemporary")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="network" className="mt-3 border-0 outline-none">
                <SessionNetworkSection
                  proxyId={proxyId}
                  setProxyId={setProxyId}
                  proxies={proxies}
                  jumpHostId={jumpHostId}
                  setJumpHostId={setJumpHostId}
                  jumpHostOptions={jumpHostOptions}
                />
              </TabsContent>

              <TabsContent value="display" className="mt-3 border-0 outline-none">
                <div className="rounded-lg border bg-accent/25 p-3">
                  <div className={fixedDisplay ? "grid gap-3 sm:grid-cols-3" : "grid gap-3"}>
                    <div>
                      <Label className="text-xs font-medium text-foreground/80">
                        {t("dialog.rdpDisplayMode")}
                      </Label>
                      <Select
                        value={normalizedDisplayMode}
                        onValueChange={(value) => setDisplayMode(value as RdpDisplayMode)}
                      >
                        <SelectTrigger className="mt-1 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fit-window">
                            {t("dialog.rdpDisplayFitWindow")}
                          </SelectItem>
                          <SelectItem value="fixed">{t("dialog.rdpDisplayFixed")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {fixedDisplay && (
                      <>
                        <div>
                          <Label className="text-xs font-medium text-foreground/80">
                            {t("dialog.rdpWidth")}
                          </Label>
                          <NumberInput
                            className="mt-1 [&_button]:h-8 [&_button]:w-8 [&_input]:h-8 [&_input]:text-xs"
                            value={displayWidth}
                            onChange={setDisplayWidth}
                            min={640}
                            max={7680}
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-foreground/80">
                            {t("dialog.rdpHeight")}
                          </Label>
                          <NumberInput
                            className="mt-1 [&_button]:h-8 [&_button]:w-8 [&_input]:h-8 [&_input]:text-xs"
                            value={displayHeight}
                            onChange={setDisplayHeight}
                            min={480}
                            max={4320}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="clipboard" className="mt-3 border-0 outline-none">
                <div className="rounded-lg border bg-accent/25 p-3">
                  <div className="max-w-md">
                    <Label className="text-xs font-medium text-foreground/80">
                      {t("dialog.rdpClipboard")}
                    </Label>
                    <Select
                      value={clipboardMode}
                      onValueChange={(value) => setClipboardMode(value as RdpClipboardMode)}
                    >
                      <SelectTrigger className="mt-1 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text-and-files">
                          {t("dialog.rdpClipboardTextAndFiles")}
                        </SelectItem>
                        <SelectItem value="text-only">
                          {t("dialog.rdpClipboardTextOnly")}
                        </SelectItem>
                        <SelectItem value="disabled">{t("dialog.disabled")}</SelectItem>
                      </SelectContent>
                    </Select>
                    {clipboardMode === "text-and-files" ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {t("dialog.rdpClipboardFilesHint")}
                      </p>
                    ) : null}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="reconnect" className="mt-3 border-0 outline-none">
                <div className="rounded-lg border bg-accent/25 p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border bg-background/70 px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-0.5">
                          <div className="text-xs font-medium">{t("dialog.rdpAutoReconnect")}</div>
                          <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
                            {t("dialog.rdpAutoReconnectDesc")}
                          </p>
                        </div>
                        <Switch checked={reconnectEnabled} onCheckedChange={setReconnectEnabled} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-foreground/80">
                        {t("dialog.rdpReconnectAttempts")}
                      </Label>
                      <NumberInput
                        className="mt-1 [&_button]:h-8 [&_button]:w-8 [&_input]:h-8 [&_input]:text-xs"
                        value={reconnectMaxAttempts}
                        onChange={setReconnectMaxAttempts}
                        min={0}
                        max={20}
                        disabled={!reconnectEnabled}
                      />
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs font-medium text-foreground/80">{label}</Label>
      <Switch checked={Boolean(checked)} onCheckedChange={onCheckedChange} />
    </div>
  );
}
