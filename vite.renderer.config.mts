import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { noPostHogPlugin } from "./src/lib/no-posthog-plugin.mts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ReactCompilerConfig = {};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    noPostHogPlugin(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", ReactCompilerConfig]],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Monaco editor (~10-15MB) — lazy-loaded separately
          if (id.includes("node_modules/monaco-editor")) return "monaco-editor";
          // Vendor libraries — stable, rarely change
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/@tanstack/react-router/") ||
            id.includes("node_modules/@tanstack/react-query/") ||
            id.includes("node_modules/jotai/")
          )
            return "vendor";
          // UI components — shared across routes
          if (
            id.includes("node_modules/@base-ui/react/") ||
            id.includes("node_modules/lucide-react/") ||
            id.includes("node_modules/sonner/")
          )
            return "ui";
          // Analytics — defer loading
          if (id.includes("node_modules/posthog-js/")) return "analytics";
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
});
