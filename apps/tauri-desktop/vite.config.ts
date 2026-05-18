import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(import.meta.dirname, "src"),
  build: {
    outDir: resolve(import.meta.dirname, "dist", "src"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, "src", "index.html")
    }
  }
});
