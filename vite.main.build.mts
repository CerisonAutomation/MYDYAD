import { builtinModules } from "node:module";
import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`]);

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
    lib: {
      entry: "src/main.ts",
      formats: ["cjs"],
      fileName: "main",
    },
    rollupOptions: {
      external: [
        ...nodeBuiltins,
        "better-sqlite3",
        "dyad-keychain-reader",
        "node-pty",
        "mustardscript",
        "pg",
        "playwright",
        "playwright-core",
        "chromium-bidi",
        // Playwright sub-dependencies
        "chromium-bidi/lib/**",
        // Catch-all for node_modules that should not be bundled
        /node_modules\//,
      ],
      output: {
        entryFileNames: "main.js",
      },
    },
    rolldownOptions: {
      external: [
        ...nodeBuiltins,
        "better-sqlite3",
        "dyad-keychain-reader",
        "node-pty",
        "mustardscript",
        "pg",
        "playwright",
        "playwright-core",
        "chromium-bidi",
        "chromium-bidi/lib/**",
      ],
    },
  },
  plugins: [],
});
