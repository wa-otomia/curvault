import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite dev server is fronted by Tauri; bind to a known port so the Rust
  // side can spawn the right window.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Tauri's own files don't need Vite HMR
      ignored: ["**/src-tauri/**"],
    },
  },

  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
}));
