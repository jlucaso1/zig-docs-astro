// @ts-check
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  output: "static",
  base: process.env.BASE_URL,
  site: process.env.SITE,
  vite: {
    build: {
      assetsInlineLimit: 0, // Ensure WebAssembly files aren't inlined
    },
    optimizeDeps: {
      exclude: ["fs", "path", "cheerio"], // Node.js modules used at build time
    },
  },
});
