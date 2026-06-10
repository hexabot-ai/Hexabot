/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  parseAuditHeaders,
  parseCsv,
  parseIntWithFallback,
  parseOptionalInt,
} from './parse';

describe('parse helpers', () => {
  describe('parseIntWithFallback', () => {
    it('parses integers and falls back for empty or invalid values', () => {
      expect(parseIntWithFallback('42', 1)).toBe(42);
      expect(parseIntWithFallback(undefined, 1)).toBe(1);
      expect(parseIntWithFallback('invalid', 1)).toBe(1);
    });
  });

  describe('parseOptionalInt', () => {
    it('parses integers and returns undefined for missing or invalid values', () => {
      expect(parseOptionalInt('42')).toBe(42);
      expect(parseOptionalInt(undefined)).toBeUndefined();
      expect(parseOptionalInt('invalid')).toBeUndefined();
    });
  });

  describe('parseCsv', () => {
    it('splits comma-separated values and trims empty entries', () => {
      expect(parseCsv(' first, ,second ', [])).toEqual(['first', 'second']);
    });

    it('trims array values without splitting them again', () => {
      expect(parseCsv([' first ', '', 'second,third'], [])).toEqual([
        'first',
        'second,third',
      ]);
    });

    it('uses the fallback for missing values', () => {
      expect(parseCsv(undefined, ['fallback'])).toEqual(['fallback']);
    });
  });

  describe('parseAuditHeaders', () => {
    it('parses JSON object values into string headers', () => {
      expect(parseAuditHeaders('{"x-api-key":"secret","retry":3}')).toEqual({
        'x-api-key': 'secret',
        retry: '3',
      });
    });

    it('returns an empty object for invalid or non-object values', () => {
      expect(parseAuditHeaders(undefined)).toEqual({});
      expect(parseAuditHeaders('not-json')).toEqual({});
      expect(parseAuditHeaders('[]')).toEqual({});
    });
  });
});
