import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MdClose, MdVisibility, MdVisibilityOff } from "react-icons/md";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface FtpFormProps {
  host: string;
  setHost: (value: string) => void;
  port: number;
  setPort: (value: number) => void;
  root: string;
  setRoot: (value: string) => void;
  username: string;
  setUsername: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  hasPassword: boolean;
  setHasPassword: (value: boolean) => void;
  useTls: boolean;
  setUseTls: (value: boolean) => void;
}

const MASKED_SECRET_PLACEHOLDER = "********";

function RequiredMark() {
  return <span className="ml-0.5 text-destructive">*</span>;
}

export function FtpForm({
  host,
  setHost,
  port,
  setPort,
  root,
  setRoot,
  username,
  setUsername,
  password,
  setPassword,
  hasPassword,
  setHasPassword,
  useTls,
  setUseTls,
}: FtpFormProps) {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="w-full space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
        <div>
          <Label className="text-xs font-medium text-foreground/80">
            {t("dialog.ftpHost", "Host")}
            <RequiredMark />
          </Label>
          <Input
            className="mt-1 h-8 text-xs"
            placeholder="ftp.example.com"
            value={host}
            onChange={(event) => setHost(event.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs font-medium text-foreground/80">
            {t("dialog.ftpPort", "Port")}
          </Label>
          <Input
            className="mt-1 h-8 text-xs"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(event) => setPort(Number(event.target.value) || 21)}
          />
        </div>
      </div>

      <div>
        <Label className="text-xs font-medium text-foreground/80">
          {t("dialog.ftpRoot", "Root path")}
        </Label>
        <Input
          className="mt-1 h-8 text-xs"
          placeholder="/"
          value={root}
          onChange={(event) => setRoot(event.target.value)}
        />
      </div>

      <div>
        <Label className="text-xs font-medium text-foreground/80">
          {t("dialog.ftpUsername", "Username")}
        </Label>
        <Input
          className="mt-1 h-8 text-xs"
          autoComplete="off"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </div>

      <div>
        <Label className="text-xs font-medium text-foreground/80">
          {t("dialog.ftpPassword", "Password")}
        </Label>
        <div className="relative mt-1">
          <Input
            className="h-8 pr-16 text-xs"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            placeholder={
              hasPassword && !password ? MASKED_SECRET_PLACEHOLDER : undefined
            }
            onChange={(event) => {
              setPassword(event.target.value);
              if (event.target.value) setHasPassword(false);
            }}
          />
          <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            <button
              type="button"
              className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              title={
                showPassword
                  ? t("dialog.hidePassword", "Hide password")
                  : t("dialog.showPassword", "Show password")
              }
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? (
                <MdVisibilityOff className="text-sm" />
              ) : (
                <MdVisibility className="text-sm" />
              )}
            </button>
            {(password || hasPassword) && (
              <button
                type="button"
                className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
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
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div className="min-w-0 pr-3">
          <span className="text-xs font-medium">
            {t("dialog.ftpUseTls", "Use TLS (FTPS)")}
          </span>
          <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
            {t(
              "dialog.ftpUseTlsDesc",
              "Enable explicit FTPS when your server requires a secure connection.",
            )}
          </p>
        </div>
        <Switch checked={useTls} onCheckedChange={setUseTls} />
      </div>
    </div>
  );
}
