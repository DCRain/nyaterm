// @ts-nocheck
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { reactDevToolsPlus } from "react-devtools-plus/vite";
import tailwindcss from "@tailwindcss/vite";
import browserslist from "browserslist";
import { browserslistToTargets } from "lightningcss";

const host = process.env.TAURI_DEV_HOST;

/** Must match `REACT_DEVTOOLS_PLUS_STORAGE_KEY` in src/lib/reactDevtoolsPlus.ts */
const REACT_DEVTOOLS_PLUS_STORAGE_KEY = "nyaterm.react-devtools-plus.enabled";

/**
 * react-devtools-plus auto-boots its overlay on every page load.
 * Gate that boot behind sessionStorage so Help → React DevTools can opt in.
 */
function deferReactDevtoolsPlusOverlay() {
  return {
    name: "defer-react-devtools-plus-overlay",
    apply: "serve",
    transformIndexHtml: {
      order: "post",
      handler(html: string) {
        const gated = `if ((() => { try { return sessionStorage.getItem('${REACT_DEVTOOLS_PLUS_STORAGE_KEY}') === '1'; } catch { return false; } })()) {
  if (window.__REACT_DEVTOOLS_GLOBALS_READY__) {
    loadOverlay();
  } else {
    window.addEventListener('react-devtools-globals-ready', loadOverlay, { once: true });
    setTimeout(() => {
      if (!window.__REACT_DEVTOOLS_OVERLAY_LOADED__) {
        window.__REACT_DEVTOOLS_OVERLAY_LOADED__ = true;
        loadOverlay();
      }
    }, 1000);
  }
}`;
        return html.replace(
          /if \(window\.__REACT_DEVTOOLS_GLOBALS_READY__\) \{\s*loadOverlay\(\);\s*\} else \{[\s\S]*?1000\);\s*\}/,
          gated,
        );
      },
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    // Dev-only; overlay stays off until Help → React DevTools enables it.
    reactDevToolsPlus({
      launchEditor: "cursor",
      rootSelector: "#root",
      theme: { mode: "dark", primaryColor: "react" },
    }),
    deferReactDevtoolsPlusOverlay(),
    tailwindcss(),
  ] as any,
  css: {
    transformer: "lightningcss",
    lightningcss: {
      targets: browserslistToTargets(browserslist("safari >= 14, chrome >= 105")),
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    cssMinify: "lightningcss",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          xterm: [
            "@xterm/xterm",
            "@xterm/addon-fit",
            "@xterm/addon-image",
            "@xterm/addon-web-links",
            "@xterm/addon-webgl",
            "@xterm/addon-search",
          ],
          tauri: ["@tauri-apps/api"],
        },
      },
    },
  },
}));
