import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MdClose, MdVisibility, MdVisibilityOff } from "react-icons/md";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface S3FormProps {
  endpoint: string;
  setEndpoint: (value: string) => void;
  bucket: string;
  setBucket: (value: string) => void;
  region: string;
  setRegion: (value: string) => void;
  root: string;
  setRoot: (value: string) => void;
  accessKeyId: string;
  setAccessKeyId: (value: string) => void;
  secretAccessKey: string;
  setSecretAccessKey: (value: string) => void;
  sessionToken: string;
  setSessionToken: (value: string) => void;
  hasSecretAccessKey: boolean;
  setHasSecretAccessKey: (value: boolean) => void;
  virtualHostStyle: boolean;
  setVirtualHostStyle: (value: boolean) => void;
}

const MASKED_SECRET_PLACEHOLDER = "********";

function RequiredMark() {
  return <span className="ml-0.5 text-destructive">*</span>;
}

export function S3Form({
  endpoint,
  setEndpoint,
  bucket,
  setBucket,
  region,
  setRegion,
  root,
  setRoot,
  accessKeyId,
  setAccessKeyId,
  secretAccessKey,
  setSecretAccessKey,
  sessionToken,
  setSessionToken,
  hasSecretAccessKey,
  setHasSecretAccessKey,
  virtualHostStyle,
  setVirtualHostStyle,
}: S3FormProps) {
  const { t } = useTranslation();
  const [showSecret, setShowSecret] = useState(false);

  return (
    <div className="w-full space-y-3">
      <div>
        <Label className="text-xs font-medium text-foreground/80">
          {t("dialog.s3Endpoint", "Endpoint")}
        </Label>
        <Input
          className="mt-1 h-8 text-xs"
          placeholder="https://s3.amazonaws.com"
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs font-medium text-foreground/80">
            {t("dialog.s3Bucket", "Bucket")}
            <RequiredMark />
          </Label>
          <Input
            className="mt-1 h-8 text-xs"
            placeholder="my-bucket"
            value={bucket}
            onChange={(event) => setBucket(event.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs font-medium text-foreground/80">
            {t("dialog.s3Region", "Region")}
          </Label>
          <Input
            className="mt-1 h-8 text-xs"
            placeholder="us-east-1"
            value={region}
            onChange={(event) => setRegion(event.target.value)}
          />
        </div>
      </div>

      <div>
        <Label className="text-xs font-medium text-foreground/80">
          {t("dialog.s3Root", "Root prefix")}
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
          {t("dialog.s3AccessKeyId", "Access Key ID")}
        </Label>
        <Input
          className="mt-1 h-8 text-xs"
          autoComplete="off"
          value={accessKeyId}
          onChange={(event) => setAccessKeyId(event.target.value)}
        />
      </div>

      <div>
        <Label className="text-xs font-medium text-foreground/80">
          {t("dialog.s3SecretAccessKey", "Secret Access Key")}
        </Label>
        <div className="relative mt-1">
          <Input
            className="h-8 pr-16 text-xs"
            type={showSecret ? "text" : "password"}
            autoComplete="new-password"
            value={secretAccessKey}
            placeholder={
              hasSecretAccessKey && !secretAccessKey
                ? MASKED_SECRET_PLACEHOLDER
                : undefined
            }
            onChange={(event) => {
              setSecretAccessKey(event.target.value);
              if (event.target.value) setHasSecretAccessKey(false);
            }}
          />
          <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            <button
              type="button"
              className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              title={
                showSecret
                  ? t("dialog.hidePassword", "Hide password")
                  : t("dialog.showPassword", "Show password")
              }
              onClick={() => setShowSecret((value) => !value)}
            >
              {showSecret ? (
                <MdVisibilityOff className="text-sm" />
              ) : (
                <MdVisibility className="text-sm" />
              )}
            </button>
            {(secretAccessKey || hasSecretAccessKey) && (
              <button
                type="button"
                className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                title={t("dialog.clearPassword", "Clear password")}
                onClick={() => {
                  setSecretAccessKey("");
                  setHasSecretAccessKey(false);
                  setShowSecret(false);
                }}
              >
                <MdClose className="text-sm" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div>
        <Label className="text-xs font-medium text-foreground/80">
          {t("dialog.s3SessionToken", "Session Token")}
        </Label>
        <Input
          className="mt-1 h-8 text-xs"
          autoComplete="off"
          value={sessionToken}
          onChange={(event) => setSessionToken(event.target.value)}
        />
      </div>

      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div className="min-w-0 pr-3">
          <span className="text-xs font-medium">
            {t("dialog.s3VirtualHostStyle", "Virtual host style")}
          </span>
          <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
            {t(
              "dialog.s3VirtualHostStyleDesc",
              "Use virtual-hosted-style URLs when required by your provider.",
            )}
          </p>
        </div>
        <Switch checked={virtualHostStyle} onCheckedChange={setVirtualHostStyle} />
      </div>
    </div>
  );
}
