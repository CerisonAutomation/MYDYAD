import { fileURLToPath } from "url";
import path from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        "electron",
        "node:buffer",
        "node:events",
        "node:fs",
        "node:http",
        "node:net",
        "node:path",
        "node:stream",
        "node:string_decoder",
        "node:tls",
        "node:url",
        "node:util",
        "node:zlib",
        "node:dns",
        "node:os",
        "assert",
        "buffer",
        "child_process",
        "crypto",
        "events",
        "fs",
        "http",
        "https",
        "net",
        "os",
        "path",
        "querystring",
        "stream",
        "string_decoder",
        "tls",
        "url",
        "util",
        "zlib",
      ],
      output: {
        entryFileNames: "preload.js",
        format: "cjs",
      },
    },
    lib: {
      entry: path.resolve(__dirname, "src/preload.ts"),
      formats: ["cjs"],
      fileName: () => "preload.js",
    },
    outDir: path.resolve(__dirname, ".vite/build"),
    emptyOutDir: false,
  },
});
