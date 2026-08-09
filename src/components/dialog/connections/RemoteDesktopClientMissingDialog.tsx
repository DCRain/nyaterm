import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RemoteDesktopClientInstallRecommendation } from "@/lib/remoteDesktop";

interface RemoteDesktopClientMissingDialogProps {
  open: boolean;
  protocol: "rdp" | "vnc" | null;
  recommendations: RemoteDesktopClientInstallRecommendation[];
  onClose: () => void;
}

export default function RemoteDesktopClientMissingDialog({
  open,
  protocol,
  recommendations,
  onClose,
}: RemoteDesktopClientMissingDialogProps) {
  const { t } = useTranslation();
  const protocolLabel = protocol === "vnc" ? "VNC" : "RDP";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("remoteDesktop.clientMissingTitle", {
              protocol: protocolLabel,
              defaultValue: "{{protocol}} client not found",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("remoteDesktop.clientMissingDescription", {
              protocol: protocolLabel,
              defaultValue:
                "Install one of the recommended clients below, then try connecting again.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 space-y-3 overflow-y-auto py-1">
          {recommendations.map((item) => (
            <div
              key={item.id}
              className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs"
            >
              <div className="font-medium text-foreground">{item.name}</div>
              <div className="mt-1 whitespace-pre-wrap text-muted-foreground">
                {item.install_hint}
              </div>
              {item.download_url ? (
                <Button
                  type="button"
                  variant="link"
                  className="mt-1 h-auto px-0 text-xs"
                  onClick={() => void openUrl(item.download_url!)}
                >
                  {t("remoteDesktop.openDownloadPage", "Open download page")}
                </Button>
              ) : null}
            </div>
          ))}
          {recommendations.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t(
                "remoteDesktop.noRecommendations",
                "No install recommendations are available for this platform.",
              )}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.close", "Close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
