/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Read from disk: Vitest stubs stylesheet imports, `?raw` ones included.
const srcDir = import.meta.dirname;
const stylesheets = readdirSync(srcDir, { recursive: true, encoding: "utf8" })
  .filter((path) => /\.s?css$/.test(path))
  .map((path) => [path, readFileSync(join(srcDir, path), "utf8")] as const);

describe("widget stylesheets", () => {
  it("collects the component stylesheets", () => {
    const paths = stylesheets.map(([path]) => path);

    expect(paths).toContain(join("components", "ChatWindow.scss"));
    expect(paths).toContain(join("components", "Launcher.scss"));
  });

  // An `!important` in the stock CSS wins over the widget's own media
  // queries (the phone full-screen layout) and over embedder overrides.
  it.each(stylesheets)("%s declares nothing as !important", (_path, css) => {
    expect(css).not.toMatch(/!\s*important/i);
  });
});
