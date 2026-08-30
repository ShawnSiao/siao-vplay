import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? "127.0.0.1",
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
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: true,
  },
  build: mode === "e2e"
    ? {
        rollupOptions: {
          input: {
            main: resolve(__dirname, "index.html"),
            library: resolve(__dirname, "e2e/library.html"),
            player: resolve(__dirname, "e2e/player.html"),
            dialog: resolve(__dirname, "e2e/dialog.html"),
            subtitleTranslation: resolve(__dirname, "e2e/subtitle-translation.html"),
            runtime: resolve(__dirname, "e2e/runtime.html"),
          },
        },
      }
    : undefined,
}));
