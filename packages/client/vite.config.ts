import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true, target: "es2022", chunkSizeWarningLimit: 800 },
  server: { port: 5173 },
});
