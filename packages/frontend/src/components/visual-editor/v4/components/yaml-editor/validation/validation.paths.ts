/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { LineCounter, Node, parseDocument } from "yaml";

export type ReferencePath = Array<string | number>;

type YamlDocument = ReturnType<typeof parseDocument>;

// Fallback range so Monaco can still surface a marker when node mapping fails.
const DEFAULT_RANGE = {
  startLineNumber: 1,
  startColumn: 1,
  endLineNumber: 1,
  endColumn: 2,
};
// Convert YAML node offsets to Monaco ranges while guaranteeing a visible span.
const getRangeFromNode = (
  node: Node | null | undefined,
  lineCounter: LineCounter,
) => {
  if (!node?.range) return null;
  const [startOffset, , endOffset] = node.range;
  const startPos = lineCounter.linePos(startOffset);
  const endPos = lineCounter.linePos(endOffset);
  const startLineNumber = startPos.line || 1;
  const startColumn = startPos.col || 1;
  const endLineNumber = endPos.line || startLineNumber;
  let endColumn = endPos.col || startColumn + 1;

  if (endLineNumber === startLineNumber && endColumn <= startColumn) {
    endColumn = startColumn + 1;
  }

  return { startLineNumber, startColumn, endLineNumber, endColumn };
};

// Resolve a YAML path to the most specific range we can find for stable markers.
export const getRangeForPath = (
  doc: YamlDocument,
  path: ReferencePath,
  lineCounter: LineCounter,
) => {
  const directNode = doc.getIn(path, true) as Node | undefined;
  const directRange = getRangeFromNode(directNode, lineCounter);

  if (directRange) {
    return directRange;
  }

  // Required fields may not have a YAML node, and their whole section may be
  // absent too. Walk upward until an existing owner node can be highlighted.
  for (let pathLength = path.length - 1; pathLength > 0; pathLength -= 1) {
    const ancestorNode = doc.getIn(path.slice(0, pathLength), true) as
      | Node
      | undefined;
    const ancestorRange = getRangeFromNode(ancestorNode, lineCounter);

    if (ancestorRange) {
      return ancestorRange;
    }
  }

  return DEFAULT_RANGE;
};
