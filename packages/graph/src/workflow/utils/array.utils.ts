/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

/**
 * Element-wise equality of two arrays, either of which may be missing: a
 * missing array only equals another missing one.
 */
export const areArraysEqual = <T>(
  left: readonly T[] | undefined,
  right: readonly T[] | undefined,
  isEqual: (leftItem: T, rightItem: T) => boolean = (leftItem, rightItem) =>
    leftItem === rightItem,
): boolean => {
  if (left === right) {
    return true;
  }

  if (!left || !right || left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => isEqual(item, right[index]));
};
