/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

export const sanitizeCredential = <T extends Record<string, unknown>>(
  credential: T,
): Omit<T, 'value'> => {
  const { value: _value, ...safeCredential } = credential;

  return safeCredential;
};

export const omitKeysDeep = <T>(value: T, keys: readonly string[]): T => {
  if (Array.isArray(value)) {
    return value.map((item) => omitKeysDeep(item, keys)) as T;
  }

  if (value === null || typeof value !== 'object' || value instanceof Date) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !keys.includes(key))
      .map(([key, nestedValue]) => [key, omitKeysDeep(nestedValue, keys)]),
  ) as T;
};

export const resolveRelationId = (
  relation: string | { id?: string | null } | null | undefined,
): string | null => {
  if (typeof relation === 'string') {
    return relation;
  }

  return relation?.id ?? null;
};
