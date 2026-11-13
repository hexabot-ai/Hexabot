/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

export interface QueryTermsFilter {
  /** Words or phrases to remove from the query. */
  excludedTerms?: readonly string[];
  /** Phrases left intact even when they contain an excluded term. */
  preservedPhrases?: readonly string[];
}

export interface FilteredQuery {
  /** The query once the excluded terms are removed. */
  query: string;
  /** The excluded terms (as configured) that were removed, in query order. */
  removedTerms: string[];
}

interface Span {
  start: number;
  end: number;
}

const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}_]';
const STARTS_WITH_WORD_CHAR = new RegExp(`^${WORD_CHAR}`, 'u');
const ENDS_WITH_WORD_CHAR = new RegExp(`${WORD_CHAR}$`, 'u');
const PUNCTUATION_ONLY = /^[\p{P}\p{S}]+$/u;
const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * NFC-normalizes the terms, collapses their inner whitespace and drops blank
 * entries and case-insensitive duplicates.
 */
const normalizeTerms = (terms: readonly string[]): string[] => {
  const unique = new Map<string, string>();
  for (const term of terms) {
    const normalized = term.normalize('NFC').trim().replace(/\s+/g, ' ');
    const key = normalized.toLocaleLowerCase();
    if (normalized && !unique.has(key)) {
      unique.set(key, normalized);
    }
  }

  return [...unique.values()];
};
/**
 * Finds the case-insensitive occurrences of a term that are whole words: a
 * term edge that is a letter or digit must not touch another letter or digit.
 * Any whitespace run matches the spaces between the words of a phrase.
 */
const findSpans = (text: string, term: string): Span[] => {
  const body = term.split(' ').map(escapeRegExp).join('\\s+');
  const before = STARTS_WITH_WORD_CHAR.test(term) ? `(?<!${WORD_CHAR})` : '';
  const after = ENDS_WITH_WORD_CHAR.test(term) ? `(?!${WORD_CHAR})` : '';

  return Array.from(
    text.matchAll(new RegExp(`${before}${body}${after}`, 'giu')),
    ({ index, 0: match }) => ({ start: index, end: index + match.length }),
  );
};
const overlaps = (a: Span, b: Span): boolean =>
  a.start < b.end && b.start < a.end;
/**
 * Collapses whitespace and drops the punctuation-only tokens a removal leaves
 * at either end of the query (e.g. the `:` of `Brand: offers`).
 */
const tidy = (value: string): string => {
  const tokens = value.split(/\s+/u).filter(Boolean);
  while (tokens.length && PUNCTUATION_ONLY.test(tokens[0])) {
    tokens.shift();
  }
  while (tokens.length && PUNCTUATION_ONLY.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  return tokens.join(' ');
};

/**
 * Removes excluded terms from a retrieval query, such as a brand name that
 * every indexed page repeats and that would otherwise match all of them.
 *
 * Matching ignores case and only matches whole words; a phrase matches across
 * any whitespace. Where excluded terms overlap, the one starting first wins,
 * then the longest. An occurrence that overlaps a preserved phrase is kept, so
 * excluding a brand does not break a product name that contains it.
 *
 * When nothing would be left of the query, it is returned unchanged.
 *
 * @param query - The query to filter.
 * @param filter - The terms to remove and the phrases to keep.
 *
 * @returns The filtered query and the excluded terms that were removed.
 */
export const removeQueryTerms = (
  query: string,
  { excludedTerms = [], preservedPhrases = [] }: QueryTermsFilter,
): FilteredQuery => {
  const unchanged: FilteredQuery = { query, removedTerms: [] };
  const terms = normalizeTerms(excludedTerms);
  if (!terms.length) {
    return unchanged;
  }

  const text = query.normalize('NFC');
  const protectedSpans = normalizeTerms(preservedPhrases).flatMap((phrase) =>
    findSpans(text, phrase),
  );
  const candidates = terms
    .flatMap((term) => findSpans(text, term).map((span) => ({ ...span, term })))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const removed: typeof candidates = [];
  for (const candidate of candidates) {
    const previous = removed[removed.length - 1];
    if (
      (!previous || previous.end <= candidate.start) &&
      !protectedSpans.some((span) => overlaps(span, candidate))
    ) {
      removed.push(candidate);
    }
  }

  let cursor = 0;
  let remaining = '';
  for (const { start, end } of removed) {
    remaining += `${text.slice(cursor, start)} `;
    cursor = end;
  }
  const filtered = tidy(remaining + text.slice(cursor));
  if (!removed.length || !filtered) {
    return unchanged;
  }

  return {
    query: filtered,
    removedTerms: [...new Set(removed.map(({ term }) => term))],
  };
};
