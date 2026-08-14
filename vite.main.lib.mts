import { builtinModules } from "node:module";
import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`]);

export default defineConfig({
  root: __dirname,
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
      entry: path.resolve(__dirname, "src/main.ts"),
      formats: ["cjs"],
      fileName: () => "main.js",
    },
    outDir: path.resolve(__dirname, ".vite/build"),
    rollupOptions: {
      external: [
        ...nodeBuiltins,
        "better-sqlite3",
        "dyad-keychain-reader",
        "node-pty",
        "mustardscript",
        "pg",
      ],
      output: {
        entryFileNames: "main-[hash].js",
      },
    },
    emptyOutDir: false,
  },
  plugins: [],
});
