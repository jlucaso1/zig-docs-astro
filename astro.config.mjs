// @ts-check
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  output: 'static',
  vite: {
    build: {
      assetsInlineLimit: 0, // Ensure WebAssembly files aren't inlined
    },
    optimizeDeps: {
      exclude: ["fs", "path", "tar-stream"], // Node.js modules used at build time
    },
  },
});
