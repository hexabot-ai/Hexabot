/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

/**
 * Deep-clone a value, preferring `structuredClone` and falling back to a JSON
 * round trip, then to a shallow copy for values neither can handle.
 *
 * @param value The value to clone.
 * @returns A detached copy of the value.
 */
export function cloneValue<T>(value: T): T {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to JSON clone below.
    }
  }

  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    if (Array.isArray(value)) {
      return [...value] as T;
    }

    if (isRecord(value)) {
      return { ...value } as T;
    }

    return value;
  }
}

/**
 * Copy a value through a JSON round trip, exactly as a host persisting it
 * would: dates become ISO strings, and `undefined` values and functions are
 * dropped.
 *
 * @param value The value to copy.
 * @returns A detached, JSON-only copy of the value.
 * @throws {TypeError} When JSON cannot encode the value (BigInt, cycles).
 */
export function cloneAsJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Deep-clone a record.
 *
 * @param value The record to clone.
 * @returns A detached copy of the record.
 */
export function cloneRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return cloneValue(value) as Record<string, unknown>;
}

/**
 * Report whether a value is a plain (non-array) object.
 *
 * @param value The value to check.
 * @returns True when the value is a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
