/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  getAllowedDomains,
  isAllowedOrigin,
  normalizeOrigin,
  splitAllowedOrigins,
} from './origin';

describe('origin helpers', () => {
  describe('splitAllowedOrigins', () => {
    it('splits comma-separated origins and trims empty values', () => {
      expect(
        splitAllowedOrigins(' https://example.com, ,https://test.com/path '),
      ).toEqual(['https://example.com', 'https://test.com/path']);
    });
  });

  describe('getAllowedDomains', () => {
    it('returns source allowed domains or wildcard fallback', () => {
      expect(
        getAllowedDomains({ allowed_domains: 'https://example.com' }),
      ).toBe('https://example.com');
      expect(getAllowedDomains({ allowed_domains: 123 })).toBe('*');
    });
  });

  describe('normalizeOrigin', () => {
    it('normalizes http origins and rejects invalid origins', () => {
      expect(normalizeOrigin('https://example.com/path')).toBe(
        'https://example.com',
      );
      expect(normalizeOrigin('not-a-url')).toBeNull();
      expect(normalizeOrigin('chrome-extension://abc')).toBeNull();
      expect(normalizeOrigin(undefined)).toBeNull();
    });
  });

  describe('isAllowedOrigin', () => {
    it('allows exact normalized origins', () => {
      expect(
        isAllowedOrigin('https://example.com', [
          'https://example.com',
          'https://other.com',
        ]),
      ).toBe(true);
    });

    it('normalizes allowed origins before comparison', () => {
      expect(
        isAllowedOrigin(
          'https://example.com',
          ' https://example.com/some/path ',
        ),
      ).toBe(true);
    });

    it('allows wildcard origins', () => {
      expect(isAllowedOrigin('https://example.com', ' * ')).toBe(true);
    });

    it('rejects unmatched origins', () => {
      expect(
        isAllowedOrigin('https://example.com', 'https://allowed.example.com'),
      ).toBe(false);
    });

    it('reports invalid request origins', () => {
      expect(isAllowedOrigin('not-a-url', '*')).toBe(false);
    });

    it('rejects non-http request origins', () => {
      expect(isAllowedOrigin('chrome-extension://abc', '*')).toBe(false);
    });

    it('ignores invalid allowed origins', () => {
      expect(
        isAllowedOrigin('https://example.com', 'not-a-url,https://example.com'),
      ).toBe(true);
    });
  });
});
