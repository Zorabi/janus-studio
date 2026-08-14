import { defineConfig } from "vite";

export default defineConfig({
  define: {
    __UPDATE_REPOSITORY__: JSON.stringify(process.env.JANUSGRAPH_UPDATE_REPOSITORY ?? ""),
    __UPDATE_BASE_URL__: JSON.stringify(process.env.JANUSGRAPH_UPDATE_BASE_URL ?? ""),
    // `ws` conditionally loads native acceleration packages. Vite cannot
    // preserve their CommonJS optional-require shape inside the main-process
    // bundle and otherwise emits an empty namespace whose `.mask()` crashes at
    // runtime. The built-in JavaScript paths are portable and fast enough for
    // Gremlin traffic.
    "process.env.WS_NO_BUFFER_UTIL": JSON.stringify("1"),
    "process.env.WS_NO_UTF_8_VALIDATE": JSON.stringify("1"),
  },
  build: {
    target: "node22",
    rollupOptions: {
      external: ["electron", /^node:/],
    },
  },
});
