import { useTranslation } from "react-i18next";
import type { SessionPane } from "@/types/global";
import DualPaneFileWorkspace from "./DualPaneFileWorkspace";

interface SftpWorkspaceProps {
  pane: SessionPane;
  visible: boolean;
}

export default function SftpWorkspace({ pane, visible }: SftpWorkspaceProps) {
  const { t } = useTranslation();
  return (
    <DualPaneFileWorkspace
      pane={pane}
      visible={visible}
      rightBackend="remote"
      rightSessionType="SSH"
      rightHeader={t("sftpWorkspace.remote")}
    />
  );
}
