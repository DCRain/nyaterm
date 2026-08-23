import { useTranslation } from "react-i18next";
import type { SessionPane } from "@/types/global";
import DualPaneFileWorkspace from "./DualPaneFileWorkspace";

interface S3WorkspaceProps {
  pane: SessionPane;
  visible: boolean;
}

export default function S3Workspace({ pane, visible }: S3WorkspaceProps) {
  const { t } = useTranslation();
  return (
    <DualPaneFileWorkspace
      pane={pane}
      visible={visible}
      rightBackend="s3"
      rightSessionType="S3"
      rightHeader={t("s3Workspace.remote")}
    />
  );
}
