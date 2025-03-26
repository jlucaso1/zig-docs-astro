// @ts-check
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  output: 'static',
  base: import.meta.env.BASE_URL,
  site: import.meta.env.SITE,
  vite: {
    build: {
      assetsInlineLimit: 0, // Ensure WebAssembly files aren't inlined
    },
    optimizeDeps: {
      exclude: ["fs", "path"], // Node.js modules used at build time
    },
  },
});
