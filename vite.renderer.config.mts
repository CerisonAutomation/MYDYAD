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
});
