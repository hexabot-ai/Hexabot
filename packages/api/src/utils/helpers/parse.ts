/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

export const parseIntWithFallback = (
  value: string | undefined,
  fallback: number,
): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);

  return Number.isNaN(parsed) ? fallback : parsed;
};

export const parseOptionalInt = (
  value: string | undefined,
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);

  return Number.isNaN(parsed) ? undefined : parsed;
};

export const parseCsv = (
  value: string | string[] | undefined,
  fallback: string[],
): string[] => {
  if (!value) {
    return fallback;
  }

  const values = Array.isArray(value) ? value : value.split(',');

  return values
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

export const parseAuditHeaders = (
  value: string | undefined,
): Record<string, string> => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).map(([key, headerValue]) => [
        key,
        String(headerValue),
      ]),
    );
  } catch {
    return {};
  }
};
