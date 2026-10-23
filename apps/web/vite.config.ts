import { cssVariables, THEME } from "@epidle/ui-theme";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Text favicon: a terminal "E_" in the theme colors. Not the Epitech logo, see DECISIONS.md. */
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="4" fill="${THEME.background.hex}"/><text x="4" y="24" font-family="monospace" font-weight="bold" font-size="24" fill="${THEME.primary.hex}">E</text><rect x="19" y="21" width="9" height="3" fill="${THEME.accent.hex}"/></svg>`;

/**
 * Writes the theme tokens into index.html: the colors live in packages/ui-theme only, and the page
 * has them before any script runs, so no flash of unstyled colors.
 */
function theme(): Plugin {
  return {
    name: "epidle-theme",
    transformIndexHtml: () => [
      { tag: "style", children: `:root { ${cssVariables()} }` },
      { tag: "meta", attrs: { name: "theme-color", content: THEME.background.hex } },
      {
        tag: "link",
        attrs: {
          rel: "icon",
          type: "image/svg+xml",
          href: `data:image/svg+xml,${encodeURIComponent(FAVICON)}`,
        },
      },
    ],
  };
}

export default defineConfig({
  plugins: [react(), theme()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});
