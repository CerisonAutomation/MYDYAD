// Replicates Electron Forge's vite plugin build config for the main process.
// Usage: npx vite build --config vite.main.rebuild.mts
import { builtinModules } from "node:module";
import { defineConfig, mergeConfig } from "vite";
import userConfig from "./vite.main.config.mts";

const forgeExternals = [
  "electron",
  "electron/common",
  "electron/main",
  ...builtinModules.flatMap((m) => [m, `node:${m}`]),
];

export default defineConfig(
  mergeConfig(
    {
      configFile: false,
      clearScreen: false,
      define: {
        MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(
          "http://localhost:5173",
        ),
        MAIN_WINDOW_VITE_NAME: JSON.stringify("main_window"),
      },
      build: {
        copyPublicDir: false,
        outDir: ".vite/build",
        emptyOutDir: false,
        minify: true,
        lib: {
          entry: "src/main.ts",
          fileName: () => "[name].js",
          formats: ["cjs"],
        },
        rollupOptions: {
          external: forgeExternals,
        },
      },
      resolve: {
        conditions: ["node"],
        mainFields: ["module", "jsnext:main", "jsnext"],
      },
    },
    userConfig as Record<string, unknown>,
  ),
);
