import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dir = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(dir, "..");

export default defineConfig({
  root: dir,
  base: "./",
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.join(workspace, "src") },
  },
  server: {
    fs: { allow: [workspace] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
