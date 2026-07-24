/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

export interface RagChunk {
  index: number;
  text: string;
}

/**
 * Splits canonical content text into deterministic, overlapping character
 * windows. Newline boundaries are preferred in the latter half of a window;
 * oversized lines are hard-split at the configured size.
 */
export const chunkSearchText = (
  source: string,
  chunkSize: number,
  overlap: number,
): RagChunk[] => {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError('Chunk size must be a positive integer.');
  }
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize) {
    throw new RangeError(
      'Chunk overlap must be a non-negative integer smaller than chunk size.',
    );
  }

  const text = source.replace(/\r\n?/g, '\n');
  const chunks: RagChunk[] = [];
  let start = 0;

  while (start < text.length) {
    const hardEnd = Math.min(start + chunkSize, text.length);
    let end = hardEnd;

    if (hardEnd < text.length) {
      const minimumBoundary = start + Math.floor(chunkSize / 2);
      const paragraphBoundary = text.lastIndexOf('\n\n', hardEnd - 1);
      const lineBoundary = text.lastIndexOf('\n', hardEnd - 1);
      if (paragraphBoundary >= minimumBoundary) {
        end = paragraphBoundary + 2;
      } else if (lineBoundary >= minimumBoundary) {
        end = lineBoundary + 1;
      }
    }

    const value = text.slice(start, end).trim();
    if (value) {
      chunks.push({
        index: chunks.length,
        text: value,
      });
    }

    if (end >= text.length) {
      break;
    }

    const nextStart = Math.max(0, end - overlap);
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
};
