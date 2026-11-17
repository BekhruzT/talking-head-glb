import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    lib: { entry: { index: "src/index.ts", heads: "src/heads/index.ts", server: "src/server/index.ts" }, formats: ["es"] },
    // Peers and dependencies stay imports; only this package's own source is bundled.
    rolldownOptions: { external: (id) => !id.startsWith(".") && !id.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(id) && !id.startsWith("\0") },
  },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/setup-tests.ts" },
});
