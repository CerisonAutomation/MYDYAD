import { build } from "vite";
import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const forgeExternals = ["electron", "electron/common", "electron/main"];

// Build main
await build(
  defineConfig({
    configFile: false,
    clearScreen: false,
    define: {
      MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify("http://localhost:5173"),
    },
    build: {
      copyPublicDir: false,
      outDir: path.join(__dirname, ".vite/build"),
      emptyOutDir: false,
      minify: true,
      lib: {
        entry: path.join(__dirname, "src/main.ts"),
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
  }),
);

console.log("Main built successfully");
