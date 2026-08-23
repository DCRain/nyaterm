import { useTranslation } from "react-i18next";
import type { SessionPane } from "@/types/global";
import DualPaneFileWorkspace from "./DualPaneFileWorkspace";

interface WebDavWorkspaceProps {
  pane: SessionPane;
  visible: boolean;
}

export default function WebDavWorkspace({ pane, visible }: WebDavWorkspaceProps) {
  const { t } = useTranslation();
  return (
    <DualPaneFileWorkspace
      pane={pane}
      visible={visible}
      rightBackend="webdav"
      rightSessionType="WebDAV"
      rightHeader={t("webdavWorkspace.remote")}
    />
  );
}
