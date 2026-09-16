export interface SettingsPaneController {
  isDirty: () => boolean;
  discard: () => void;
  save: () => Promise<boolean>;
}

const controllers = new Map<string, SettingsPaneController>();

export function registerSettingsPane(paneId: string, controller: SettingsPaneController) {
  controllers.set(paneId, controller);
  return () => {
    if (controllers.get(paneId) === controller) {
      controllers.delete(paneId);
    }
  };
}

export function getDirtySettingsPaneIds(paneIds?: Iterable<string>) {
  const candidates = paneIds ?? controllers.keys();
  return [...candidates].filter((paneId) => controllers.get(paneId)?.isDirty());
}

export async function saveSettingsPanes(paneIds: Iterable<string>) {
  for (const paneId of paneIds) {
    const controller = controllers.get(paneId);
    if (controller && !(await controller.save())) {
      return false;
    }
  }
  return true;
}

export function discardSettingsPanes(paneIds: Iterable<string>) {
  for (const paneId of paneIds) {
    controllers.get(paneId)?.discard();
  }
}
