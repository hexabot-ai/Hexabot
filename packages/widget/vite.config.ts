/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import dts from "vite-plugin-dts";
import { defineConfig } from "vitest/config";

/** Emits `.br`/`.gz` siblings for self-hosting. CDNs compress on their own. */
const precompressAssets = (outDir: string): Plugin => ({
  name: "hexabot-precompress-assets",
  apply: "build",
  closeBundle() {
    // Only what an embedder loads directly; `.es.js` goes through a bundler.
    // Runs per output format, so a file a later pass emits is compressed then.
    for (const name of ["hexabot-widget.umd.js", "style.css"]) {
      const file = resolve(outDir, name);

      if (!existsSync(file)) continue;

      const source = readFileSync(file);
      const params = {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
      };

      writeFileSync(`${file}.gz`, gzipSync(source, { level: 9 }));
      writeFileSync(`${file}.br`, brotliCompressSync(source, { params }));
    }
  },
});

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      react(),
      // tsconfig.app.json sets `noEmit`, which silently drops declarations.
      dts({ tsconfigPath: "./tsconfig.build.json" }),
      precompressAssets(resolve(__dirname, "dist")),
    ],
    server: {
      host: "0.0.0.0",
    },
    define: {
      "process.env":
        mode === "development" ? { "process.env": process.env } : {},
      // React is bundled, so we pick its flavor; unset ships the dev build.
      // Production only: vitest shares this config, and React's production
      // build omits `act`.
      "process.env.NODE_ENV": JSON.stringify(
        mode === "production" ? "production" : "development",
      ),
    },
    build: {
      // `clean` runs first instead: the umd pass would wipe the es pass's types.
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, "src/embed.tsx"),
        name: "HexabotWidget",
        fileName: (format) => `hexabot-widget.${format}.js`,
        cssFileName: "style",
      },
      // React stays bundled: v19 ships no UMD build for a script tag to load.
      rolldownOptions: {
        output: {
          exports: "named",
        },
      },
    },
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      setupFiles: "./src/test/setup.ts",
    },
  };
});
