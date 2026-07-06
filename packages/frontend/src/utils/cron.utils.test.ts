/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_CRON_STATE,
  type CronState,
  fromCron,
  toCron,
} from "./cron.utils";

const state = (patch: Partial<CronState>): CronState => ({
  ...DEFAULT_CRON_STATE,
  ...patch,
});

describe("toCron", () => {
  it("serializes simple frequencies", () => {
    expect(toCron(state({ frequency: "second" }))).toBe("* * * * * *");
    expect(toCron(state({ frequency: "minute" }))).toBe("0 * * * * *");
    expect(toCron(state({ frequency: "hour", minute: 15 }))).toBe(
      "0 15 * * * *",
    );
    expect(toCron(state({ frequency: "day", hour: 9, minute: 30 }))).toBe(
      "0 30 9 * * *",
    );
    expect(
      toCron(state({ frequency: "week", hour: 9, minute: 30, dayOfWeek: 5 })),
    ).toBe("0 30 9 * * 5");
    expect(
      toCron(
        state({ frequency: "month", hour: 9, minute: 30, dayOfMonth: 15 }),
      ),
    ).toBe("0 30 9 15 * *");
  });

  it("serializes intervals as step expressions", () => {
    expect(toCron(state({ frequency: "second", interval: 30 }))).toBe(
      "*/30 * * * * *",
    );
    expect(toCron(state({ frequency: "minute", interval: 30 }))).toBe(
      "0 */30 * * * *",
    );
    expect(toCron(state({ frequency: "hour", interval: 2, minute: 5 }))).toBe(
      "0 5 */2 * * *",
    );
  });
});

describe("fromCron", () => {
  it("parses step expressions", () => {
    expect(fromCron("*/30 * * * * *")).toEqual(
      state({ frequency: "second", interval: 30 }),
    );
    expect(fromCron("0 */30 * * * *")).toEqual(
      state({ frequency: "minute", interval: 30 }),
    );
    expect(fromCron("0 5 */2 * * *")).toEqual(
      state({ frequency: "hour", interval: 2, minute: 5 }),
    );
  });

  it("normalizes 5-field expressions", () => {
    expect(fromCron("*/5 * * * *")).toEqual(
      state({ frequency: "minute", interval: 5 }),
    );
    expect(fromCron("30 9 * * 1")).toEqual(
      state({ frequency: "week", hour: 9, minute: 30, dayOfWeek: 1 }),
    );
  });

  it("falls back to the default state on invalid input", () => {
    expect(fromCron("not a cron")).toEqual(DEFAULT_CRON_STATE);
    expect(fromCron("")).toEqual(DEFAULT_CRON_STATE);
  });

  it("round-trips every state produced by toCron", () => {
    const states: CronState[] = [
      state({ frequency: "second" }),
      state({ frequency: "second", interval: 10 }),
      state({ frequency: "minute" }),
      state({ frequency: "minute", interval: 15 }),
      state({ frequency: "hour", minute: 45 }),
      state({ frequency: "hour", interval: 6, minute: 0 }),
      state({ frequency: "day", hour: 23, minute: 59 }),
      state({ frequency: "week", hour: 8, minute: 0, dayOfWeek: 0 }),
      state({ frequency: "month", hour: 12, minute: 30, dayOfMonth: 31 }),
    ];

    for (const s of states) {
      expect(fromCron(toCron(s))).toEqual(s);
    }
  });
});
