/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

/**
 * Read a nested value. Array segments must be numbers; a path that leaves
 * the value resolves to `undefined`.
 */
export const getValueAtPath = (
  value: unknown,
  path: ReadonlyArray<string | number>,
): unknown =>
  path.reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) {
      return undefined;
    }
    if (Array.isArray(acc)) {
      return typeof key === 'number' ? acc[key] : undefined;
    }
    if (typeof acc === 'object') {
      return (acc as Record<string, unknown>)[String(key)];
    }

    return undefined;
  }, value);

/**
 * Copy a value with one nested value replaced; the input is left untouched.
 * A path that does not fit the value returns it as is.
 */
export const setValueAtPath = <T>(
  value: T,
  path: ReadonlyArray<string | number>,
  nextValue: unknown,
): T => {
  if (path.length === 0) {
    return nextValue as T;
  }

  const [key, ...rest] = path;

  if (Array.isArray(value)) {
    if (typeof key !== 'number') {
      return value;
    }
    const nextArray = [...value];

    nextArray[key] = setValueAtPath(value[key], rest, nextValue);

    return nextArray as unknown as T;
  }

  if (value && typeof value === 'object') {
    return {
      ...(value as Record<string, unknown>),
      [String(key)]: setValueAtPath(
        (value as Record<string, unknown>)[String(key)],
        rest,
        nextValue,
      ),
    } as T;
  }

  return value;
};
