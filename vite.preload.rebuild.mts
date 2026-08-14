import { builtinModules } from "node:module";
import { defineConfig, mergeConfig } from "vite";
import userConfig from "./vite.preload.config.mts";

const forgeExternals = [
  "electron",
  "electron/common",
  "electron/renderer",
  ...builtinModules.flatMap((m) => [m, `node:${m}`]),
];

export default defineConfig(
  mergeConfig(
    {
      configFile: false,
      clearScreen: false,
      build: {
        copyPublicDir: false,
        outDir: ".vite/build",
        emptyOutDir: false,
        minify: true,
        lib: {
          entry: "src/preload.ts",
          fileName: () => "preload.js",
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
