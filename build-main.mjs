import { build } from "vite";
import { builtinModules } from "node:module";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const _nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`]);

await build({
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
      fileName: () => "main.js",
    },
    outDir: ".vite/build",
    rollupOptions: {
      external: [
        ..._nodeBuiltins,
        "better-sqlite3",
        "dyad-keychain-reader",
        "node-pty",
        "mustardscript",
        "pg",
      ],
      output: {
        entryFileNames: "[name].js",
      },
    },
    target: "node14",
    minify: false,
  },
  define: {
    MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(""),
    MAIN_WINDOW_VITE_NAME: JSON.stringify("main_window"),
    "process.env.IS_E2E_TEST_BUILD": JSON.stringify("true"),
  },
  plugins: [],
});
