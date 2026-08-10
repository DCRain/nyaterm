/** sessionStorage key — must match the Vite HTML gate in vite.config.ts */
export const REACT_DEVTOOLS_PLUS_STORAGE_KEY = "nyaterm.react-devtools-plus.enabled";

export function isReactDevtoolsPlusEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return sessionStorage.getItem(REACT_DEVTOOLS_PLUS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Toggle react-devtools-plus overlay and reload so injection/unmount stays clean. */
export function toggleReactDevtoolsPlus(): void {
  if (!import.meta.env.DEV) return;
  try {
    const next = !isReactDevtoolsPlusEnabled();
    if (next) {
      sessionStorage.setItem(REACT_DEVTOOLS_PLUS_STORAGE_KEY, "1");
    } else {
      sessionStorage.removeItem(REACT_DEVTOOLS_PLUS_STORAGE_KEY);
    }
  } catch {
    // ignore storage failures
  }
  window.location.reload();
}
