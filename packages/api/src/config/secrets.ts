/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { config } from '.';

/**
 * Secret values that ship with Hexabot: the fallbacks of the config and the
 * values of the `.env.example` files. Anyone can sign session cookies or
 * tokens with them.
 */
const PUBLIC_SECRET_VALUES: ReadonlySet<string> = new Set([
  'changeme',
  'dev_only',
  'f661ff500fff6b0c8f91310b6fff6b0c',
  'DEFAULT_SIGNED_URL_SECRET',
  'DEFAULT_PASSWORD_RESET_SECRET',
  'DEFAULT_CONFIRM_ACCOUNT_SECRET',
]);

type Secret = string | Buffer | undefined;

/**
 * The secrets the API signs with, keyed by the env variable that sets them.
 */
export const getSigningSecrets = (): Record<string, Secret> => ({
  SESSION_SECRET: config.session.secret,
  SIGNED_URL_SECRET: config.parameters.signedUrl.secret,
  PASSWORD_RESET_SECRET: config.password_reset.jwtOptions.secret,
  CONFIRM_ACCOUNT_SECRET: config.confirm_account.jwtOptions.secret,
});

/**
 * Lists the env variables of the secrets that are empty or left to a value
 * that ships with Hexabot.
 *
 * @param secrets - The secrets, keyed by env variable.
 * @returns The env variables to set.
 */
export const findPublicSecrets = (
  secrets: Record<string, Secret> = getSigningSecrets(),
): string[] =>
  Object.entries(secrets)
    .filter(
      ([, value]) =>
        !value?.length ||
        (typeof value === 'string' && PUBLIC_SECRET_VALUES.has(value)),
    )
    .map(([envVar]) => envVar);

/**
 * Builds the message reporting the secrets to set, or `undefined` when all
 * of them are set.
 *
 * @param secrets - The secrets, keyed by env variable.
 */
export const describePublicSecrets = (
  secrets: Record<string, Secret> = getSigningSecrets(),
): string | undefined => {
  const envVars = findPublicSecrets(secrets);
  if (!envVars.length) {
    return undefined;
  }

  return (
    `${envVars.join(', ')} ${envVars.length > 1 ? 'are' : 'is'} unset or ` +
    'set to a value that ships with Hexabot, so anyone can forge session ' +
    'cookies or signed tokens. Set each one to a unique random value ' +
    '(e.g. `openssl rand -hex 32`).'
  );
};
