/**
 * Vite config for Electron preload script.
 *
 * IMPORTANT: Forge's VitePlugin handles preload builds through its own
 * config resolution pipeline. The merge order is:
 *   1. vite.base.config  (outDir: '.vite/build', emptyOutDir: false, watch)
 *   2. vite.preload.config  (rollupOptions.input, output format CJS,
 *      inlineDynamicImports, entryFileNames, external: builtins + electron/renderer)
 *   3. THIS user config  (applied LAST via mergeConfig)
 *
 * DO NOT set any of these — Forge's preload config already handles them:
 *   - build.lib or rollupOptions.input (entry comes from forge.config.ts)
 *   - build.outDir (already .vite/build)
 *   - build.target (already node16 via Forge's base config)
 *   - rollupOptions.external (already includes all node builtins + electron/renderer)
 *   - rollupOptions.output.format (already CJS)
 *   - rollupOptions.output.inlineDynamicImports (already true)
 *   - rollupOptions.output.entryFileNames (already [name].js)
 *   - Any plugins (Forge adds pluginHotRestart('reload') for preload HMR)
 *
 * Setting any of the above in this file will OVERRIDE Forge's config
 * (since user config is applied last), which breaks preload loading
 * at runtime — causing the blank screen / "IPC renderer not available" error.
 */
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Only set non-conflicting overrides here.
    // minify is safe to override — Forge defaults to true in prod, false in dev.
    minify: false,
  },
});
