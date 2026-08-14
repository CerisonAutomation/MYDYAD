import { fileURLToPath } from "url";
import path from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`]);

export default defineConfig({
  build: {
    sourcemap: true,
    lib: {
      entry: path.resolve(
        __dirname,
        "workers/supabase_dependency_analysis/supabase_dependency_analysis_worker.ts",
      ),
      name: "supabase_dependency_analysis_worker",
      fileName: "supabase_dependency_analysis_worker",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: [...nodeBuiltins, "@typescript/typescript6"],
    },
  },
});
