/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import { formatDurationMs } from "./date";

describe("formatDurationMs", () => {
  it("formats empty and millisecond values", () => {
    expect(formatDurationMs(null)).toBe("-");
    expect(formatDurationMs(undefined)).toBe("-");
    expect(formatDurationMs(250)).toBe("250ms");
  });

  it("formats seconds, minutes, and hours", () => {
    expect(formatDurationMs(25000)).toBe("25s");
    expect(formatDurationMs(61000)).toBe("1m 1s");
    expect(formatDurationMs(3661000)).toBe("1h 1m 1s");
  });

  it("uses a custom separator", () => {
    expect(formatDurationMs(61000, "")).toBe("1m1s");
  });
});
