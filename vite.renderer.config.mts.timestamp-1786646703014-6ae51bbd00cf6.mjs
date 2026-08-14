// vite.renderer.config.mts
import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "file:///Users/cb/Downloads/dyad-main/node_modules/@tailwindcss/vite/dist/index.mjs";
import react from "file:///Users/cb/Downloads/dyad-main/node_modules/@vitejs/plugin-react/dist/index.js";
import { defineConfig } from "file:///Users/cb/Downloads/dyad-main/node_modules/vite/dist/node/index.js";
var __vite_injected_original_import_meta_url =
  "file:///Users/cb/Downloads/dyad-main/vite.renderer.config.mts";
var __filename = fileURLToPath(__vite_injected_original_import_meta_url);
var __dirname = path.dirname(__filename);
var ReactCompilerConfig = {};
var vite_renderer_config_default = defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", ReactCompilerConfig]],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "posthog-js/react": path.resolve(
        __dirname,
        "./src/lib/stubs/posthog-js-react.ts",
      ),
      "posthog-js": path.resolve(__dirname, "./src/lib/stubs/posthog-js.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
  },
});
export { vite_renderer_config_default as default };
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5yZW5kZXJlci5jb25maWcubXRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiL1VzZXJzL2NiL0Rvd25sb2Fkcy9keWFkLW1haW5cIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy9jYi9Eb3dubG9hZHMvZHlhZC1tYWluL3ZpdGUucmVuZGVyZXIuY29uZmlnLm10c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvY2IvRG93bmxvYWRzL2R5YWQtbWFpbi92aXRlLnJlbmRlcmVyLmNvbmZpZy5tdHNcIjtpbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJ1cmxcIjtcbmltcG9ydCB0YWlsd2luZGNzcyBmcm9tIFwiQHRhaWx3aW5kY3NzL3ZpdGVcIjtcbmltcG9ydCByZWFjdCBmcm9tIFwiQHZpdGVqcy9wbHVnaW4tcmVhY3RcIjtcbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gXCJ2aXRlXCI7XG5cbmNvbnN0IF9fZmlsZW5hbWUgPSBmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCk7XG5jb25zdCBfX2Rpcm5hbWUgPSBwYXRoLmRpcm5hbWUoX19maWxlbmFtZSk7XG5cbmNvbnN0IFJlYWN0Q29tcGlsZXJDb25maWcgPSB7fTtcblxuLy8gaHR0cHM6Ly92aXRlLmRldi9jb25maWcvXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbXG4gICAgcmVhY3Qoe1xuICAgICAgYmFiZWw6IHtcbiAgICAgICAgcGx1Z2luczogW1tcImJhYmVsLXBsdWdpbi1yZWFjdC1jb21waWxlclwiLCBSZWFjdENvbXBpbGVyQ29uZmlnXV0sXG4gICAgICB9LFxuICAgIH0pLFxuICAgIHRhaWx3aW5kY3NzKCksXG4gIF0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgXCJAXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmNcIiksXG4gICAgICBcInBvc3Rob2ctanMvcmVhY3RcIjogcGF0aC5yZXNvbHZlKFxuICAgICAgICBfX2Rpcm5hbWUsXG4gICAgICAgIFwiLi9zcmMvbGliL3N0dWJzL3Bvc3Rob2ctanMtcmVhY3QudHNcIixcbiAgICAgICksXG4gICAgICBcInBvc3Rob2ctanNcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyYy9saWIvc3R1YnMvcG9zdGhvZy1qcy50c1wiKSxcbiAgICB9LFxuICB9LFxuICBzZXJ2ZXI6IHtcbiAgICBob3N0OiBcIjEyNy4wLjAuMVwiLFxuICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQTZSLE9BQU8sVUFBVTtBQUM5UyxTQUFTLHFCQUFxQjtBQUM5QixPQUFPLGlCQUFpQjtBQUN4QixPQUFPLFdBQVc7QUFDbEIsU0FBUyxvQkFBb0I7QUFKK0ksSUFBTSwyQ0FBMkM7QUFNN04sSUFBTSxhQUFhLGNBQWMsd0NBQWU7QUFDaEQsSUFBTSxZQUFZLEtBQUssUUFBUSxVQUFVO0FBRXpDLElBQU0sc0JBQXNCLENBQUM7QUFHN0IsSUFBTywrQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUztBQUFBLElBQ1AsTUFBTTtBQUFBLE1BQ0osT0FBTztBQUFBLFFBQ0wsU0FBUyxDQUFDLENBQUMsK0JBQStCLG1CQUFtQixDQUFDO0FBQUEsTUFDaEU7QUFBQSxJQUNGLENBQUM7QUFBQSxJQUNELFlBQVk7QUFBQSxFQUNkO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLEtBQUssUUFBUSxXQUFXLE9BQU87QUFBQSxNQUNwQyxvQkFBb0IsS0FBSztBQUFBLFFBQ3ZCO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFBQSxNQUNBLGNBQWMsS0FBSyxRQUFRLFdBQVcsK0JBQStCO0FBQUEsSUFDdkU7QUFBQSxFQUNGO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsRUFDUjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
