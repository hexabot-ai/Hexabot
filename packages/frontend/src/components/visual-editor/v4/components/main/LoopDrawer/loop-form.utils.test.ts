/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import {
  applyLoopFieldChange,
  buildLoopStep,
  getLoopFormErrors,
  getLoopFormValues,
  isLoopStep,
  type LoopFormValues,
  type LoopStep,
} from "./loop-form.utils";

const forEachStep: LoopStep = {
  loop: {
    type: "for_each",
    name: "each_order",
    for_each: { item: "order", in: "=$input.orders" },
    max_concurrency: 4,
    until: "=$iteration.done",
    accumulate: {
      as: "totals",
      initial: [],
      merge: "=$append($accumulator, 1)",
    },
    steps: [{ do: "charge" }],
  },
};
const formValues = (overrides: Partial<LoopFormValues> = {}) => ({
  ...getLoopFormValues(),
  ...overrides,
});

describe("isLoopStep", () => {
  it("accepts steps with a loop that has steps", () => {
    expect(isLoopStep(forEachStep)).toBe(true);
    expect(isLoopStep({ loop: {} })).toBe(false);
    expect(isLoopStep({ do: "charge" })).toBe(false);
    expect(isLoopStep(null)).toBe(false);
  });
});

describe("getLoopFormValues", () => {
  it("starts a new loop as a for_each loop with defaults", () => {
    expect(getLoopFormValues()).toEqual({
      loopType: "for_each",
      name: "",
      description: "",
      forEachItem: "item",
      forEachIn: "=[]",
      whileCondition: "=true",
      maxConcurrency: "",
      until: "",
      accumulateEnabled: false,
      accumulateAs: "items",
      accumulateInitial: "[]",
      accumulateMerge: "=$append($accumulator, [$iteration.item])",
    });
  });

  it("reads the fields of a for_each loop", () => {
    expect(getLoopFormValues(forEachStep)).toMatchObject({
      loopType: "for_each",
      name: "each_order",
      forEachItem: "order",
      forEachIn: "=$input.orders",
      maxConcurrency: "4",
      until: "=$iteration.done",
      accumulateEnabled: true,
      accumulateAs: "totals",
      accumulateInitial: "[]",
    });
  });

  it("reads the condition of a while loop", () => {
    expect(
      getLoopFormValues({
        loop: { type: "while", while: "=$count < 3", steps: [] },
      }),
    ).toMatchObject({ loopType: "while", whileCondition: "=$count < 3" });
  });
});

describe("getLoopFormErrors", () => {
  it("reports nothing for the defaults", () => {
    expect(Object.values(getLoopFormErrors(formValues()))).toEqual(
      Array(8).fill(undefined),
    );
  });

  it("requires the for_each item and an expression to iterate", () => {
    expect(
      getLoopFormErrors(formValues({ forEachItem: " ", forEachIn: "" })),
    ).toMatchObject({ forEachItem: "required", forEachIn: "required" });
    expect(getLoopFormErrors(formValues({ forEachIn: "[1]" })).forEachIn).toBe(
      "jsonata_required",
    );
  });

  it("requires a positive integer max concurrency", () => {
    for (const maxConcurrency of ["0", "-1", "1.5", "abc"]) {
      expect(
        getLoopFormErrors(formValues({ maxConcurrency })).maxConcurrency,
      ).toBe("positive_integer");
    }
    expect(
      getLoopFormErrors(formValues({ maxConcurrency: " 3 " })).maxConcurrency,
    ).toBeUndefined();
  });

  it("requires the until condition to be an expression", () => {
    expect(getLoopFormErrors(formValues({ until: "done" })).until).toBe(
      "jsonata_required",
    );
  });

  it("only checks the fields of the selected loop type", () => {
    expect(
      getLoopFormErrors(
        formValues({
          loopType: "while",
          forEachItem: "",
          forEachIn: "",
          maxConcurrency: "0",
          until: "x",
          whileCondition: "true",
        }),
      ),
    ).toMatchObject({
      forEachItem: undefined,
      forEachIn: undefined,
      maxConcurrency: undefined,
      until: undefined,
      whileCondition: "jsonata_required",
    });
    expect(
      getLoopFormErrors(formValues({ loopType: "while", whileCondition: "" }))
        .whileCondition,
    ).toBe("required");
  });

  it("checks the accumulator only when it is enabled", () => {
    const accumulator = {
      accumulateAs: "",
      accumulateInitial: "{",
      accumulateMerge: "merge",
    };

    expect(getLoopFormErrors(formValues(accumulator))).toMatchObject({
      accumulateAs: undefined,
      accumulateInitial: undefined,
      accumulateMerge: undefined,
    });
    expect(
      getLoopFormErrors(
        formValues({ ...accumulator, accumulateEnabled: true }),
      ),
    ).toMatchObject({
      accumulateAs: "required",
      accumulateInitial: "json_invalid",
      accumulateMerge: "jsonata_required",
    });
    expect(
      getLoopFormErrors(
        formValues({
          accumulateEnabled: true,
          accumulateInitial: " ",
          accumulateMerge: "",
        }),
      ),
    ).toMatchObject({
      accumulateInitial: "required",
      accumulateMerge: "required",
    });
  });
});

describe("applyLoopFieldChange", () => {
  it("fills a blank while condition when switching to a while loop", () => {
    expect(
      applyLoopFieldChange(
        formValues({ whileCondition: " " }),
        "loopType",
        "while",
      ),
    ).toMatchObject({ loopType: "while", whileCondition: "=true" });
    expect(
      applyLoopFieldChange(
        formValues({ whileCondition: "=$x" }),
        "loopType",
        "while",
      ).whileCondition,
    ).toBe("=$x");
  });

  it("ignores an unknown loop type", () => {
    const values = formValues();

    expect(applyLoopFieldChange(values, "loopType", "repeat")).toBe(values);
  });

  it("fills the blank accumulator fields when enabling it", () => {
    expect(
      applyLoopFieldChange(
        formValues({
          accumulateAs: "",
          accumulateInitial: "{}",
          accumulateMerge: "",
        }),
        "accumulateEnabled",
        true,
      ),
    ).toMatchObject({
      accumulateEnabled: true,
      accumulateAs: "items",
      accumulateInitial: "{}",
      accumulateMerge: "=$append($accumulator, [$iteration.item])",
    });
    expect(
      applyLoopFieldChange(
        formValues({ accumulateEnabled: true, accumulateAs: "" }),
        "accumulateEnabled",
        false,
      ),
    ).toMatchObject({ accumulateEnabled: false, accumulateAs: "" });
  });

  it("sets other fields as text", () => {
    expect(applyLoopFieldChange(formValues(), "name", "orders").name).toBe(
      "orders",
    );
  });
});

describe("buildLoopStep", () => {
  it("round-trips a for_each loop and keeps its steps", () => {
    expect(buildLoopStep(forEachStep, getLoopFormValues(forEachStep))).toEqual(
      forEachStep,
    );
  });

  it("saves a while loop without the for_each fields", () => {
    const step = buildLoopStep(
      forEachStep,
      formValues({
        loopType: "while",
        name: "  ",
        whileCondition: " =$more ",
        maxConcurrency: "4",
        until: "=$done",
      }),
    );

    expect(step).toEqual({
      loop: { steps: [{ do: "charge" }], type: "while", while: "=$more" },
    });
  });

  it("writes the trimmed fields in the loop key order", () => {
    const step = buildLoopStep(
      forEachStep,
      formValues({
        name: " each ",
        description: " Each order ",
        forEachItem: " order ",
        forEachIn: " =$orders ",
        maxConcurrency: " 2 ",
        accumulateEnabled: true,
        accumulateInitial: ' { "n": 0 } ',
      }),
    );

    expect(step?.loop).toEqual({
      name: "each",
      description: "Each order",
      accumulate: {
        as: "items",
        initial: { n: 0 },
        merge: "=$append($accumulator, [$iteration.item])",
      },
      steps: [{ do: "charge" }],
      type: "for_each",
      for_each: { item: "order", in: "=$orders" },
      max_concurrency: 2,
    });
    expect(Object.keys(step?.loop ?? {})).toEqual([
      "name",
      "description",
      "accumulate",
      "steps",
      "type",
      "for_each",
      "max_concurrency",
    ]);
  });

  it("returns nothing when the accumulator seed is not JSON", () => {
    expect(
      buildLoopStep(
        forEachStep,
        formValues({ accumulateEnabled: true, accumulateInitial: "{" }),
      ),
    ).toBeUndefined();
  });
});
