/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { removeQueryTerms } from './remove-query-terms';

describe('removeQueryTerms', () => {
  const excludedTerms = ['Orange', 'Tunisie', 'Orange Tunisie'];

  it('returns the query unchanged when no term is excluded', () => {
    expect(removeQueryTerms('  promotions Orange  ', {})).toEqual({
      query: '  promotions Orange  ',
      removedTerms: [],
    });
    expect(
      removeQueryTerms('promotions Orange', { excludedTerms: [' ', ''] }),
    ).toEqual({ query: 'promotions Orange', removedTerms: [] });
  });

  it('removes the longest excluded phrase, ignoring case and whitespace', () => {
    expect(
      removeQueryTerms('promotions du moment orange   TUNISIE', {
        excludedTerms,
      }),
    ).toEqual({
      query: 'promotions du moment',
      removedTerms: ['Orange Tunisie'],
    });
  });

  it('removes every occurrence and reports each removed term once', () => {
    expect(
      removeQueryTerms('Tunisie forfaits Orange, recharge Orange', {
        excludedTerms,
      }),
    ).toEqual({
      query: 'forfaits , recharge',
      removedTerms: ['Tunisie', 'Orange'],
    });
  });

  it('only matches whole words, including accented ones', () => {
    expect(
      removeQueryTerms('Orangeade orangé Orange', { excludedTerms }),
    ).toEqual({ query: 'Orangeade orangé', removedTerms: ['Orange'] });
    expect(
      removeQueryTerms('offres télécom Télécom', {
        excludedTerms: ['télécom'],
      }),
    ).toEqual({ query: 'offres', removedTerms: ['télécom'] });
  });

  it('matches regardless of the Unicode normalization form', () => {
    expect(
      removeQueryTerms('offres Télécom', {
        excludedTerms: ['Télécom'],
      }),
    ).toEqual({ query: 'offres', removedTerms: ['Télécom'] });
  });

  it('treats regular expression characters in terms literally', () => {
    expect(
      removeQueryTerms('forfait C++ (offre) a.b', {
        excludedTerms: ['C++', '(offre)', 'a.b'],
      }),
    ).toEqual({
      query: 'forfait',
      removedTerms: ['C++', '(offre)', 'a.b'],
    });
    expect(removeQueryTerms('axb', { excludedTerms: ['a.b'] })).toEqual({
      query: 'axb',
      removedTerms: [],
    });
  });

  it('keeps excluded terms that are part of a preserved phrase', () => {
    expect(
      removeQueryTerms('transfert Orange Money Orange Tunisie', {
        excludedTerms,
        preservedPhrases: ['orange money'],
      }),
    ).toEqual({
      query: 'transfert Orange Money',
      removedTerms: ['Orange Tunisie'],
    });
  });

  it('falls back to a shorter term when the longest overlaps a preserved phrase', () => {
    expect(
      removeQueryTerms('Orange Tunisie Telecom', {
        excludedTerms,
        preservedPhrases: ['Tunisie Telecom'],
      }),
    ).toEqual({ query: 'Tunisie Telecom', removedTerms: ['Orange'] });
  });

  it('drops the punctuation a removal leaves at either end', () => {
    expect(
      removeQueryTerms('Orange Tunisie : forfaits mobiles - Orange', {
        excludedTerms,
      }),
    ).toEqual({
      query: 'forfaits mobiles',
      removedTerms: ['Orange Tunisie', 'Orange'],
    });
  });

  it('keeps the original query when nothing would be left of it', () => {
    expect(removeQueryTerms('Orange Tunisie ?', { excludedTerms })).toEqual({
      query: 'Orange Tunisie ?',
      removedTerms: [],
    });
  });
});
