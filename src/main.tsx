import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource-variable/noto-sans-sc";
import "./i18n";
import ErrorBoundary from "./components/ErrorBoundary";
import { Toaster } from "./components/ui/sonner";
import "./index.css";
import {
  applyThemeToDOM,
  THEME_CACHE_KEY,
  THEME_SNAPSHOT_CACHE_KEY,
  ThemeProvider,
} from "./context/ThemeContext";
import { DEFAULT_THEME_ID, themes } from "./lib/themes";
import { installWebviewReloadGuard } from "./lib/webviewReloadGuard";
import { scheduleChildWindowReady } from "./lib/windowManager";

// Apply cached theme synchronously before React renders to avoid flash
try {
  const cachedId = localStorage.getItem(THEME_CACHE_KEY);
  const cachedTheme = cachedId ? themes[cachedId] : null;
  if (cachedTheme) {
    applyThemeToDOM(cachedTheme.colors);
  } else {
    const snapshot = localStorage.getItem(THEME_SNAPSHOT_CACHE_KEY);
    const parsed = snapshot ? JSON.parse(snapshot) : null;
    if (parsed?.id === cachedId && parsed?.colors) {
      applyThemeToDOM(parsed.colors);
    } else {
      applyThemeToDOM(themes[DEFAULT_THEME_ID].colors);
    }
  }
} catch {}

installWebviewReloadGuard();
document.addEventListener("contextmenu", (e) => e.preventDefault());

const params = new URLSearchParams(window.location.search);
const windowType = params.get("window");

if (windowType) {
  // Child window: lightweight provider stack, no full App
  // These entry points are independent and should load in parallel; serial awaits would add an
  // unnecessary chunk round trip to every child-window open.
  const childRoot = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
  // Commit an inline-background loading shell before loading provider and page chunks. This lets
  // the parent reveal a stable surface without reintroducing the macOS white or empty window.
  childRoot.render(
    <div
      className="flex h-screen w-full items-center justify-center bg-background"
      style={{ backgroundColor: "var(--df-bg, #0d1117)" }}
      aria-busy="true"
    >
      <span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>,
  );
  scheduleChildWindowReady();

  const [{ ChildAppProvider }, { default: ChildWindowRouter }] = await Promise.all([
    import("./context/ChildAppProvider"),
    import("./ChildWindowRouter"),
  ]);

  childRoot.render(
    <React.StrictMode>
      <ErrorBoundary>
        <ChildAppProvider>
          <ThemeProvider>
            <ChildWindowRouter windowType={windowType} />
            <Toaster />
          </ThemeProvider>
        </ChildAppProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
} else {
  // Main window: full app with all providers
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { setOwnerMainWindowLabel } = await import("./lib/windowManager");
  const { AppProvider } = await import("./context/AppContext");
  const { default: App } = await import("./App");
  setOwnerMainWindowLabel(getCurrentWindow().label);

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <AppProvider>
          <ThemeProvider>
            <App />
            <Toaster />
          </ThemeProvider>
        </AppProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
