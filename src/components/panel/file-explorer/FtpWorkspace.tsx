import { useTranslation } from "react-i18next";
import type { SessionPane } from "@/types/global";
import DualPaneFileWorkspace from "./DualPaneFileWorkspace";

interface FtpWorkspaceProps {
  pane: SessionPane;
  visible: boolean;
}

export default function FtpWorkspace({ pane, visible }: FtpWorkspaceProps) {
  const { t } = useTranslation();
  return (
    <DualPaneFileWorkspace
      pane={pane}
      visible={visible}
      rightBackend="ftp"
      rightSessionType="FTP"
      rightHeader={t("ftpWorkspace.remote")}
    />
  );
}
