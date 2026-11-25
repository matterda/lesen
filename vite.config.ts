import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "node:child_process";

// Shown in Settings: the commit the build came from and when it was built.
const commit = (() => {
  try { return execSync("git rev-parse --short HEAD").toString().trim(); }
  catch { return process.env.GITHUB_SHA?.slice(0, 7) ?? "dev"; }
})();

export default defineConfig({
  base: "./", // works from any sub-path (e.g. GitHub Pages)
  define: {
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILT__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Lesen – German reader",
        short_name: "Lesen",
        description: "Read German books with in-context translations and flashcards",
        lang: "en",
        display: "standalone",
        start_url: ".",
        scope: ".",
        background_color: "#fbf8f2",
        theme_color: "#fbf8f2",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg,png,woff2}"] },
    }),
  ],
});
