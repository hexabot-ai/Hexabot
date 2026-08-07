/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

export function isIdentifierSafe(name: string) {
  // JSONata identifiers similar to JS-ish: start letter/_/$ then alnum/_/$
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

export function formatSegmentForJsonata(name: string) {
  return isIdentifierSafe(name) ? name : `"${name.replace(/"/g, '\\"')}"`;
}

export function indexToLineCol(
  text: string,
  index: number,
): { line: number; col: number } {
  let line = 0;
  let lastNL = -1;

  for (let i = 0; i < text.length && i < index; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      line++;
      lastNL = i;
    }
  }

  return { line, col: index - (lastNL + 1) };
}
