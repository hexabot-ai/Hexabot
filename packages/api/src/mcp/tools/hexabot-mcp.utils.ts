/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

export type McpUserRef = {
  id: string;
  firstName: string;
  lastName: string;
};

type UserRelation =
  | string
  | { id: string; firstName: string; lastName: string }
  | null
  | undefined;

/**
 * Reduce a populated user (or subscriber) relation to its id and name. The
 * populated relation is the whole record (email, roles, provider, password
 * reset state), which MCP clients never need and must not receive. An id, or
 * a missing relation, is returned as is.
 */
export const toUserRef = (
  relation: UserRelation,
): McpUserRef | string | null | undefined => {
  if (relation == null || typeof relation === 'string') {
    return relation;
  }

  return {
    id: relation.id,
    firstName: relation.firstName,
    lastName: relation.lastName,
  };
};

/**
 * Make a credential safe for MCP output: drop its secret value and reduce its
 * populated owner to a user reference.
 */
export const sanitizeCredential = <T extends Record<string, unknown>>(
  credential: T,
): Omit<T, 'value'> => {
  const { value: _value, ...safeCredential } = credential;

  if (!('owner' in safeCredential)) {
    return safeCredential;
  }

  return {
    ...safeCredential,
    owner: toUserRef(safeCredential.owner as UserRelation),
  } as Omit<T, 'value'>;
};

/**
 * List the properties of an object JSON Schema that hold a secret: those the
 * admin UI renders as a password field (`ui:widget: password`), such as a
 * license key or an access token kept in settings rather than in a credential.
 */
export const getSecretKeys = (
  schema: { properties?: Record<string, unknown> } | undefined,
): Set<string> =>
  new Set(
    Object.entries(schema?.properties ?? {})
      .filter(
        ([, property]) =>
          (property as Record<string, unknown> | null)?.['ui:widget'] ===
          'password',
      )
      .map(([key]) => key),
  );

/**
 * Tell whether a secret holds a value, without returning it.
 */
export const hasSecretValue = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== '';

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
