/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { compile } from "sass";
import { describe, expect, it } from "vitest";

// Read from disk: Vitest stubs stylesheet imports, `?raw` ones included.
const srcDir = import.meta.dirname;
const sourceFiles = readdirSync(srcDir, { recursive: true, encoding: "utf8" });
const stylesheets = sourceFiles
  .filter((path) => /\.s?css$/.test(path))
  .map((path) => [path, readFileSync(join(srcDir, path), "utf8")] as const);
const scripts = sourceFiles
  .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
  .map((path) => [path, readFileSync(join(srcDir, path), "utf8")] as const);
// Where Sass finds the packages a stylesheet loads, as Vite's resolver does.
const nodeModules = dirname(
  dirname(createRequire(import.meta.url).resolve("normalize.css/package.json")),
);
const toCss = (path: string, source: string) =>
  path.endsWith(".scss")
    ? compile(join(srcDir, path), { loadPaths: [nodeModules] }).css
    : source;
/** The selectors of every rule that declares something, keyframes aside. */
const ruleSelectors = (css: string) => {
  const selectors: string[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const walk = (from: number, to: number) => {
    let cursor = from;

    while (cursor < to) {
      const open = text.indexOf("{", cursor);

      if (open === -1 || open >= to) return;

      const prelude = text.slice(cursor, open).split(";").pop()!.trim();
      let close = open + 1;

      for (let depth = 1; depth; close++) {
        if (text[close] === "{") depth++;
        if (text[close] === "}") depth--;
      }
      if (/^@media|^@supports|^@layer/.test(prelude)) {
        walk(open + 1, close - 1);
      } else if (
        !prelude.startsWith("@") &&
        text.slice(open + 1, close - 1).trim()
      ) {
        selectors.push(
          ...prelude.split(",").map((selector) => selector.trim()),
        );
      }
      cursor = close;
    }
  };

  walk(0, text.length);

  return selectors;
};

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

  // The widget renders inside `.hb-theme-root`, so anything else, such as
  // an element reset, restyles the host page around it.
  it.each(stylesheets)(
    "%s styles nothing outside the widget",
    (path, source) => {
      const outside = ruleSelectors(toCss(path, source)).filter(
        (selector) =>
          !selector.startsWith(".") &&
          !selector.startsWith(":where(.hb-theme-root)"),
      );

      expect(outside).toEqual([]);
    },
  );

  it("imports package stylesheets only through a scoped layer", () => {
    const packageCssImports = scripts.filter(([, code]) =>
      /import\s+["'][^./][^"']*\.css["']/.test(code),
    );

    expect(packageCssImports.map(([path]) => path)).toEqual([]);
  });
});
