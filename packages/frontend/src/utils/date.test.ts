/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import i18n from "@/i18n/config";

import { formatDurationMs, getDateTimeFormatter } from "./date";

describe("getDateTimeFormatter", () => {
  it("formats datetime translations instead of exposing interpolation syntax", () => {
    i18n.addResourceBundle(
      "en",
      "translation",
      {
        datetime: {
          created_at: "{{val, datetime}}",
        },
      },
      true,
      true,
    );

    const formatted = i18n.t(
      "datetime.created_at",
      getDateTimeFormatter(new Date("2026-07-15T10:30:00Z")),
    );

    expect(formatted).not.toContain("{{");
    expect(formatted).toContain("2026");
  });
});

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
