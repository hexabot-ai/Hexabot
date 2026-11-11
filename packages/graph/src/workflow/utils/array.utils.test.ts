/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import { areArraysEqual } from "./array.utils";

describe("areArraysEqual", () => {
  it("compares items in order", () => {
    expect(areArraysEqual(["a", 1], ["a", 1])).toBe(true);
    expect(areArraysEqual(["a", 1], [1, "a"])).toBe(false);
    expect(areArraysEqual(["a"], ["a", "b"])).toBe(false);
    expect(areArraysEqual([], [])).toBe(true);
  });

  it("only treats a missing array as equal to another missing one", () => {
    expect(areArraysEqual(undefined, undefined)).toBe(true);
    expect(areArraysEqual(undefined, [])).toBe(false);
    expect(areArraysEqual([], undefined)).toBe(false);
  });

  it("compares items with strict equality unless given a comparator", () => {
    expect(areArraysEqual([{ id: 1 }], [{ id: 1 }])).toBe(false);
    expect(
      areArraysEqual([{ id: 1 }], [{ id: 1 }], (left, right) => {
        return left.id === right.id;
      }),
    ).toBe(true);
    expect(areArraysEqual([Number.NaN], [Number.NaN])).toBe(false);
  });
});
