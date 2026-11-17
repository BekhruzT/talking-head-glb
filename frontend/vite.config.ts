import { defaultClientConditions } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The "source" condition resolves the linked talking-head-glb package to its TypeScript source.
export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ["source", ...defaultClientConditions],
    dedupe: ["react", "react-dom", "three", "@react-three/fiber", "@react-three/drei"],
  },
  server: { port: 3000, strictPort: true },
  preview: { port: 3000 },
  build: { outDir: "build" },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/setupTests.ts" },
});
