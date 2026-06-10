/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { parseCsv } from './parse';

export const normalizeOrigin = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value.trim());

    return ['http:', 'https:'].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
};

export const splitAllowedOrigins = (
  allowedOrigins: string | string[],
): string[] => parseCsv(allowedOrigins, []);

export const getAllowedDomains = (settings: Record<string, unknown>): string =>
  typeof settings.allowed_domains === 'string' ? settings.allowed_domains : '*';

export const isAllowedOrigin = (
  origin: string | undefined,
  allowedOrigins: string | string[],
): boolean => {
  const normalizedOrigin = normalizeOrigin(origin);
  const allowedOriginValues = splitAllowedOrigins(allowedOrigins);

  if (!normalizedOrigin) {
    return false;
  }

  if (allowedOriginValues.includes('*')) {
    return true;
  }

  const normalizedAllowedOrigins = allowedOriginValues
    .map(normalizeOrigin)
    .filter((allowedOrigin): allowedOrigin is string => allowedOrigin !== null);

  return normalizedAllowedOrigins.includes(normalizedOrigin);
};
