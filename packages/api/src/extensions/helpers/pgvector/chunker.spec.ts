/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { chunkSearchText } from './chunker';

describe('chunkSearchText', () => {
  it('prefers paragraph and line boundaries with deterministic overlap', () => {
    const source =
      'First paragraph line.\nSecond paragraph line.\nThird paragraph line.';
    const first = chunkSearchText(source, 50, 8);
    const second = chunkSearchText(source, 50, 8);

    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first[0].text).toBe('First paragraph line.\nSecond paragraph line.');
    expect(first[1].text).toContain('Third paragraph line.');
    expect(first.map(({ index }) => index)).toEqual([0, 1]);
  });

  it('hard-splits oversized lines while retaining overlap', () => {
    expect(chunkSearchText('abcdefghij', 4, 1)).toEqual([
      { index: 0, text: 'abcd' },
      { index: 1, text: 'defg' },
      { index: 2, text: 'ghij' },
    ]);
  });

  it('normalizes line endings and discards blank chunks', () => {
    const chunks = chunkSearchText('alpha\r\n\r\nbeta', 7, 1);

    expect(chunks.every(({ text }) => text.length > 0)).toBe(true);
    expect(chunks.map(({ text }) => text).join(' ')).not.toContain('\r');
  });

  it('rejects invalid chunking settings', () => {
    expect(() => chunkSearchText('text', 0, 0)).toThrow(RangeError);
    expect(() => chunkSearchText('text', 4, 4)).toThrow(RangeError);
    expect(() => chunkSearchText('text', 4, -1)).toThrow(RangeError);
  });
});
