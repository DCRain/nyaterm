import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdChevronRight } from "react-icons/md";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import {
  listRemoteDesktopClients,
  type RemoteDesktopClientInfo,
} from "@/lib/remoteDesktop";

export type RdpDisplayMode = "fullscreen" | "windowed";
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
  setHost: (v: string) => void;
  port: number;
  setPort: (v: number) => void;
  username: string;
  setUsername: (v: string) => void;
  displayMode: RdpDisplayMode;
  setDisplayMode: (v: RdpDisplayMode) => void;
  resolutionPreset: RdpResolutionPreset;
  setResolutionPreset: (v: RdpResolutionPreset) => void;
  width: number;
  setWidth: (v: number) => void;
  height: number;
  setHeight: (v: number) => void;
  preferredClient: string;
  setPreferredClient: (v: string) => void;
  redirects: RdpRedirectSettings;
  setRedirects: (patch: Partial<RdpRedirectSettings>) => void;
}

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
    // Backend omits `true` via skip_serializing_if — treat missing as enabled.
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
  displayMode,
  setDisplayMode,
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
}: RdpFormProps) {
  const { t } = useTranslation();
  // Keep open by default so clipboard/mic defaults are visible without hunting.
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [clients, setClients] = useState<RemoteDesktopClientInfo[]>([]);

  useEffect(() => {
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
  }, []);

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
    <div className="space-y-3">
      <p className="text-[0.6875rem] leading-snug text-muted-foreground">
        {t(
          "dialog.rdpExternalHint",
          "Opens an external RDP client (such as mstsc or FreeRDP). Passwords are entered in the client.",
        )}
      </p>
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
        {displayMode === "windowed" ? (
          <p className="mt-1.5 text-[0.6875rem] leading-snug text-muted-foreground">
            {t(
              "dialog.rdpDynamicResolutionHint",
              "Windowed mode writes dynamic resolution. Windows App and FreeRDP can resize the remote desktop with the window; mstsc usually keeps a fixed resolution and may show scrollbars.",
            )}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_7rem]">
        <div>
          <Label className="text-xs font-medium text-foreground/80">
            {t("dialog.host")}
            <RequiredMark />
          </Label>
          <Input
            className="mt-1 h-8 text-xs"
            value={host}
            placeholder="192.168.1.10"
            onChange={(e) => setHost(e.target.value)}
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
            min={1}
            max={65535}
            onChange={(value) => setPort(value || 3389)}
          />
        </div>
      </div>
      <div>
        <Label className="text-xs font-medium text-foreground/80">{t("dialog.username")}</Label>
        <Input
          className="mt-1 h-8 text-xs"
          value={username}
          placeholder={DEFAULT_RDP_USERNAME}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs font-medium text-foreground/80">
            {t("dialog.rdpDisplayMode", "Display mode")}
          </Label>
          <Select
            value={displayMode}
            onValueChange={(value) => setDisplayMode(value as RdpDisplayMode)}
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

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
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
                  onChange={(e) => setRedirects({ driveRedirectCustom: e.target.value })}
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
                  onValueChange={(value) => setRedirects({ deviceRedirect: value as RdpStarOrOff })}
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
                  onValueChange={(value) => setRedirects({ cameraRedirect: value as RdpStarOrOff })}
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
