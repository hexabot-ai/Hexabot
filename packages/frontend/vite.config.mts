/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import path from "path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const monorepoRoot = path.resolve(__dirname, "../..");

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
      "@hexabot-ai/types": path.resolve(__dirname, "../types/src"),
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
