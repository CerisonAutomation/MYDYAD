/**
 * Vite config for Electron main process.
 *
 * IMPORTANT: Forge's VitePlugin merges configs in this order:
 *   1. vite.base.config  (outDir, emptyOutDir, watch, clearScreen)
 *   2. vite.main.config  (entry, lib, externals, resolve, define)
 *   3. THIS user config  (aliases, additional externals)
 *
 * User config is applied LAST via mergeConfig, so:
 *   - Do NOT set build.lib, build.outDir, build.target, or build.watch
 *     — Forge's main config already handles these from forge.config.ts
 *   - Do NOT add a 'restart' plugin — Forge's pluginHotRestart('restart')
 *     already handles main process hot restart
 *   - Do NOT set resolve.conditions or resolve.mainFields — Forge sets
 *     these for proper Node.js module resolution
 *   - Do NOT define VITE_DEV_SERVER_URL — Forge injects this
 *
 * What this file SHOULD contain:
 *   - Path aliases (src/, packages/)
 *   - Additional externals for native Node addons not in Forge's default list
 */
import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Local workspace packages — resolved from source for dev speed
      "pg-schema-classifier": path.resolve(
        __dirname,
        "./packages/pg-schema-classifier/src/index.ts",
      ),
      "ts-pg-schema-diff": path.resolve(
        __dirname,
        "./packages/ts-pg-schema-diff/src/index.ts",
      ),
    },
  },
  build: {
    rollupOptions: {
      // Additional externals beyond Forge's defaults (electron + node builtins).
      // These are native Node addons that must be loaded from node_modules
      // at runtime, not bundled into main.js.
      external: [
        "better-sqlite3",
        "dyad-keychain-reader",
        "node-pty",
        "mustardscript",
        "pg",
      ],
    },
  },
});
