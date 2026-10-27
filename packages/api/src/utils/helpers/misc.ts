/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

export const isEmpty = (value: string): boolean => {
  return value === undefined || value === null || value === '';
};

/**
 * Convert an unknown error into a readable string.
 */
export const stringifyError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return JSON.stringify(error) ?? 'Unknown error';
};
