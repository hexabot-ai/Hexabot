/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import path from "path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const monorepoRoot = path.resolve(__dirname, "../..");
const graphSrc = path.resolve(__dirname, "../graph/src");

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Avoid one-time dev-server reload when YAML editor first mounts its worker.
    include: ["monaco-yaml", "monaco-yaml/yaml.worker.js"],
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler",
      },
      sass: {
        api: "modern-compiler",
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@hexabot-ai/agentic": path.resolve(__dirname, "../agentic/src"),
      "@hexabot-ai/types": path.resolve(__dirname, "../types/src"),
      // Sub-path alias must come before the bare package alias.
      "@hexabot-ai/graph/workflow.css": path.resolve(
        graphSrc,
        "workflow/styles/index.css",
      ),
      "@hexabot-ai/graph": path.resolve(graphSrc, "index.ts"),
      "@rjsf/validator-ajv8": path.resolve(
        __dirname,
        "./src/utils/rjsf-zod-validator.ts",
      ),
    },
  },
  server: {
    host: true,
    port: 8080,
    fs: {
      allow: [monorepoRoot], // allow Vite to serve shared workspace deps like hoisted node_modules
    },
    watch: {
      // Use polling for graph/src so file reverts (atomic writes that swap
      // inodes) are always detected as a "change" event by chokidar, rather
      // than an unlink+add pair that can miss triggering hotUpdate.
      usePolling: true,
      interval: 100,
      ignored: (f: string) => {
        if (f.startsWith(graphSrc)) return false;
        return true;
      },
    },
    proxy: {
      "/api": {
        target: "http://localhost:3000/",
      },
      "/socket.io": {
        target: "ws://localhost:3000/",
      },
    },
  },
  preview: {
    host: true,
    port: 8080,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
