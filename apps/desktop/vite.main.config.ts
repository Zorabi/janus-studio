import { defineConfig } from "vite";

export default defineConfig({
  define: {
    __UPDATE_REPOSITORY__: JSON.stringify(process.env.JANUSGRAPH_UPDATE_REPOSITORY ?? ""),
    __UPDATE_BASE_URL__: JSON.stringify(process.env.JANUSGRAPH_UPDATE_BASE_URL ?? ""),
  },
  build: {
    target: "node22",
    rollupOptions: {
      external: ["electron", /^node:/],
    },
  },
});
