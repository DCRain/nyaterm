import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MdClose, MdVisibility, MdVisibilityOff } from "react-icons/md";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface WebDavFormProps {
  endpoint: string;
  setEndpoint: (value: string) => void;
  root: string;
  setRoot: (value: string) => void;
  username: string;
  setUsername: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  hasPassword: boolean;
  setHasPassword: (value: boolean) => void;
}

const MASKED_SECRET_PLACEHOLDER = "********";

function RequiredMark() {
  return <span className="ml-0.5 text-destructive">*</span>;
}

export function WebDavForm({
  endpoint,
  setEndpoint,
  root,
  setRoot,
  username,
  setUsername,
  password,
  setPassword,
  hasPassword,
  setHasPassword,
}: WebDavFormProps) {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="w-full space-y-3">
      <div>
        <Label className="text-xs font-medium text-foreground/80">
          {t("dialog.webdavEndpoint", "Endpoint")}
          <RequiredMark />
        </Label>
        <Input
          className="mt-1 h-8 text-xs"
          placeholder="https://dav.example.com/remote.php/dav/files/user"
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
        />
      </div>

      <div>
        <Label className="text-xs font-medium text-foreground/80">
          {t("dialog.webdavRoot", "Root path")}
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
          {t("dialog.webdavUsername", "Username")}
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
          {t("dialog.webdavPassword", "Password")}
        </Label>
        <div className="relative mt-1">
          <Input
            className="h-8 pr-16 text-xs"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            placeholder={hasPassword && !password ? MASKED_SECRET_PLACEHOLDER : undefined}
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
    </div>
  );
}
