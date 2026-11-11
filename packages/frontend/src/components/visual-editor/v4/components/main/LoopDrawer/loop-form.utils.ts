/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { FlowStep, JsonValue } from "@hexabot-ai/agentic";

const DEFAULT_FOR_EACH_ITEM = "item";
const DEFAULT_FOR_EACH_IN = "=[]";
const DEFAULT_LOOP_TYPE = "for_each";
const DEFAULT_WHILE_CONDITION = "=true";
const DEFAULT_ACCUMULATE_AS = "items";
const DEFAULT_ACCUMULATE_INITIAL = "[]";
const DEFAULT_ACCUMULATE_MERGE = "=$append($accumulator, [$iteration.item])";

export type LoopStep = Extract<FlowStep, { loop: unknown }>;
export type LoopDiscriminator = "for_each" | "while";
export type LoopFormValues = {
  loopType: LoopDiscriminator;
  name: string;
  description: string;
  forEachItem: string;
  forEachIn: string;
  whileCondition: string;
  maxConcurrency: string;
  until: string;
  accumulateEnabled: boolean;
  accumulateAs: string;
  accumulateInitial: string;
  accumulateMerge: string;
};
export type LoopFormErrorCode =
  | "required"
  | "jsonata_required"
  | "json_invalid"
  | "positive_integer";
export type LoopFormErrorField =
  | "forEachItem"
  | "forEachIn"
  | "whileCondition"
  | "maxConcurrency"
  | "until"
  | "accumulateAs"
  | "accumulateInitial"
  | "accumulateMerge";
export type LoopFormErrorCodes = Record<
  LoopFormErrorField,
  LoopFormErrorCode | undefined
>;

export const isLoopStep = (step: unknown): step is LoopStep => {
  if (!step || typeof step !== "object" || !("loop" in step)) {
    return false;
  }

  const loop = (step as { loop?: { steps?: unknown } }).loop;

  return Boolean(loop && Array.isArray(loop.steps));
};

export const isLoopType = (value: string): value is LoopDiscriminator =>
  value === "for_each" || value === "while";

const parseJsonValue = (value: string): JsonValue | undefined => {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return undefined;
  }
};
const isExpression = (value: string) => value.startsWith("=");
/** Trimmed text fields, the parsed max concurrency and accumulator seed. */
const normalizeLoopFormValues = (values: LoopFormValues) => {
  const maxConcurrency = values.maxConcurrency.trim();
  const accumulateInitial = values.accumulateInitial.trim();

  return {
    loopType: values.loopType,
    name: values.name.trim(),
    description: values.description.trim(),
    forEachItem: values.forEachItem.trim(),
    forEachIn: values.forEachIn.trim(),
    whileCondition: values.whileCondition.trim(),
    maxConcurrency,
    until: values.until.trim(),
    accumulateEnabled: values.accumulateEnabled,
    accumulateAs: values.accumulateAs.trim(),
    accumulateInitial,
    accumulateMerge: values.accumulateMerge.trim(),
    parsedMaxConcurrency: maxConcurrency ? Number(maxConcurrency) : undefined,
    parsedAccumulateInitial: values.accumulateEnabled
      ? parseJsonValue(accumulateInitial)
      : undefined,
  };
};

export const getLoopFormValues = (step?: LoopStep): LoopFormValues => {
  const loop = step?.loop;
  const loopType = loop?.type ?? DEFAULT_LOOP_TYPE;
  const forEach = loop?.type === "for_each" ? loop.for_each : undefined;
  const whileCondition = loop?.type === "while" ? loop.while : undefined;
  const until = loop?.type === "for_each" ? loop.until : undefined;
  const maxConcurrency =
    loop?.type === "for_each" ? loop.max_concurrency : undefined;
  const accumulate = loop?.accumulate;

  return {
    loopType,
    name: loop?.name ?? "",
    description: loop?.description ?? "",
    forEachItem: forEach?.item ?? DEFAULT_FOR_EACH_ITEM,
    forEachIn: forEach?.in ?? DEFAULT_FOR_EACH_IN,
    whileCondition: whileCondition ?? DEFAULT_WHILE_CONDITION,
    maxConcurrency:
      typeof maxConcurrency === "number" ? String(maxConcurrency) : "",
    until: until ?? "",
    accumulateEnabled: Boolean(accumulate),
    accumulateAs: accumulate?.as ?? DEFAULT_ACCUMULATE_AS,
    accumulateInitial: accumulate
      ? JSON.stringify(accumulate.initial, null, 2)
      : DEFAULT_ACCUMULATE_INITIAL,
    accumulateMerge: accumulate?.merge ?? DEFAULT_ACCUMULATE_MERGE,
  };
};

/** Why each field is invalid, `undefined` for the valid ones. */
export const getLoopFormErrors = (
  values: LoopFormValues,
): LoopFormErrorCodes => {
  const normalized = normalizeLoopFormValues(values);
  const isForEach = normalized.loopType === "for_each";
  const { accumulateEnabled, parsedMaxConcurrency } = normalized;
  const requiredExpression = (value: string, isChecked: boolean) => {
    if (!isChecked) {
      return undefined;
    }

    return !value
      ? "required"
      : !isExpression(value)
        ? "jsonata_required"
        : undefined;
  };

  return {
    forEachItem: isForEach && !normalized.forEachItem ? "required" : undefined,
    forEachIn: requiredExpression(normalized.forEachIn, isForEach),
    whileCondition: requiredExpression(
      normalized.whileCondition,
      normalized.loopType === "while",
    ),
    maxConcurrency:
      isForEach &&
      normalized.maxConcurrency !== "" &&
      (parsedMaxConcurrency === undefined ||
        !Number.isInteger(parsedMaxConcurrency) ||
        parsedMaxConcurrency <= 0)
        ? "positive_integer"
        : undefined,
    until:
      isForEach && normalized.until && !isExpression(normalized.until)
        ? "jsonata_required"
        : undefined,
    accumulateAs:
      accumulateEnabled && !normalized.accumulateAs ? "required" : undefined,
    accumulateInitial:
      accumulateEnabled && normalized.parsedAccumulateInitial === undefined
        ? !normalized.accumulateInitial
          ? "required"
          : "json_invalid"
        : undefined,
    accumulateMerge: requiredExpression(
      normalized.accumulateMerge,
      accumulateEnabled,
    ),
  };
};

/**
 * Change one field. Switching to a while loop or enabling the accumulator
 * fills the fields they need when those are blank.
 */
export const applyLoopFieldChange = (
  values: LoopFormValues,
  field: keyof LoopFormValues,
  value: string | boolean,
): LoopFormValues => {
  if (field === "loopType") {
    const nextLoopType = String(value);

    if (!isLoopType(nextLoopType)) {
      return values;
    }

    return {
      ...values,
      loopType: nextLoopType,
      whileCondition:
        nextLoopType === "while" && !values.whileCondition.trim()
          ? DEFAULT_WHILE_CONDITION
          : values.whileCondition,
    };
  }

  if (field === "accumulateEnabled") {
    if (!value) {
      return { ...values, accumulateEnabled: false };
    }

    return {
      ...values,
      accumulateEnabled: true,
      accumulateAs: values.accumulateAs.trim()
        ? values.accumulateAs
        : DEFAULT_ACCUMULATE_AS,
      accumulateInitial: values.accumulateInitial.trim()
        ? values.accumulateInitial
        : DEFAULT_ACCUMULATE_INITIAL,
      accumulateMerge: values.accumulateMerge.trim()
        ? values.accumulateMerge
        : DEFAULT_ACCUMULATE_MERGE,
    };
  }

  return {
    ...values,
    [field]: String(value),
  };
};

/**
 * The loop step saved from the form, keeping the steps it runs. `undefined`
 * when the accumulator seed is not valid JSON.
 */
export const buildLoopStep = (
  step: LoopStep,
  values: LoopFormValues,
): LoopStep | undefined => {
  const normalized = normalizeLoopFormValues(values);
  const { parsedAccumulateInitial, parsedMaxConcurrency } = normalized;

  if (normalized.accumulateEnabled && parsedAccumulateInitial === undefined) {
    return undefined;
  }

  const nextAccumulate =
    normalized.accumulateEnabled && parsedAccumulateInitial !== undefined
      ? {
          as: normalized.accumulateAs,
          initial: parsedAccumulateInitial,
          merge: normalized.accumulateMerge,
        }
      : undefined;
  const commonLoopFields = {
    ...(normalized.name ? { name: normalized.name } : {}),
    ...(normalized.description ? { description: normalized.description } : {}),
    ...(nextAccumulate ? { accumulate: nextAccumulate } : {}),
    steps: step.loop.steps ?? [],
  };
  const nextLoop =
    normalized.loopType === "while"
      ? {
          ...commonLoopFields,
          type: "while" as const,
          while: normalized.whileCondition,
        }
      : {
          ...commonLoopFields,
          type: "for_each" as const,
          for_each: {
            item: normalized.forEachItem,
            in: normalized.forEachIn,
          },
          ...(parsedMaxConcurrency !== undefined
            ? { max_concurrency: parsedMaxConcurrency }
            : {}),
          ...(normalized.until ? { until: normalized.until } : {}),
        };

  return {
    ...step,
    loop: nextLoop,
  };
};
