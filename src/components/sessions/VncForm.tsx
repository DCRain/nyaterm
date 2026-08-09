import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";

interface VncFormProps {
  host: string;
  setHost: (v: string) => void;
  port: number;
  setPort: (v: number) => void;
}

function RequiredMark() {
  return <span className="ml-0.5 text-destructive">*</span>;
}

export function VncForm({ host, setHost, port, setPort }: VncFormProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <p className="text-[0.6875rem] leading-snug text-muted-foreground">
        {t(
          "dialog.vncExternalHint",
          "Opens an external VNC client (Screen Sharing, TigerVNC, and others). Authentication happens in the client.",
        )}
      </p>
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
            onChange={(value) => setPort(value || 5900)}
          />
        </div>
      </div>
    </div>
  );
}
