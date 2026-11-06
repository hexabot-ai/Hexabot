/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  describePublicSecrets,
  findPublicSecrets,
  getSigningSecrets,
} from './secrets';

const RANDOM_SECRETS = {
  SESSION_SECRET: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
  SIGNED_URL_SECRET: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  PASSWORD_RESET_SECRET: '9f8e7d6c5b4a39281706f5e4d3c2b1a0',
  CONFIRM_ACCOUNT_SECRET: '1234567890abcdef1234567890abcdef',
};

describe('signing secrets', () => {
  it('lists every secret the API signs with', () => {
    expect(Object.keys(getSigningSecrets())).toEqual(
      Object.keys(RANDOM_SECRETS),
    );
  });

  it('accepts secrets set to unique values', () => {
    expect(findPublicSecrets(RANDOM_SECRETS)).toEqual([]);
    expect(describePublicSecrets(RANDOM_SECRETS)).toBeUndefined();
  });

  it.each([
    ['SESSION_SECRET', 'changeme'],
    ['SESSION_SECRET', 'f661ff500fff6b0c8f91310b6fff6b0c'],
    ['SIGNED_URL_SECRET', 'DEFAULT_SIGNED_URL_SECRET'],
    ['SIGNED_URL_SECRET', 'dev_only'],
    ['PASSWORD_RESET_SECRET', 'DEFAULT_PASSWORD_RESET_SECRET'],
    ['CONFIRM_ACCOUNT_SECRET', 'DEFAULT_CONFIRM_ACCOUNT_SECRET'],
    ['SIGNED_URL_SECRET', ''],
    ['SIGNED_URL_SECRET', undefined],
  ])('reports %s set to %p', (envVar, value) => {
    const secrets = { ...RANDOM_SECRETS, [envVar]: value };

    expect(findPublicSecrets(secrets)).toEqual([envVar]);
    expect(describePublicSecrets(secrets)).toMatch(
      new RegExp(`^${envVar} is unset or set to a value that ships`),
    );
  });

  it('reports the config fallbacks', () => {
    expect(
      describePublicSecrets({
        SESSION_SECRET: 'changeme',
        SIGNED_URL_SECRET: 'DEFAULT_SIGNED_URL_SECRET',
      }),
    ).toMatch(/^SESSION_SECRET, SIGNED_URL_SECRET are unset/);
  });
});
