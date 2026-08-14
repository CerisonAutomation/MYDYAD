import { fileURLToPath } from "url";
import path from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`]);

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, "src/ipc/utils/sandbox/sandbox_worker.ts"),
      name: "sandbox_worker",
      fileName: "sandbox_worker",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: [...nodeBuiltins, "mustardscript", "pg"],
    },
  },
});
