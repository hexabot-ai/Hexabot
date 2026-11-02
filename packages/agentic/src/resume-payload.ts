/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z, type ZodType } from 'zod';

import type { WaitInfo } from './checkpoint';
import { WorkflowResumeRejectedError } from './errors';
import { cloneAsJson } from './utils/clone';

type JsonSchema = Record<string, unknown>;

type ZodNode = { _zod: { def: ZodDefLike; optin?: 'optional' | 'defaulted' } };

// The parts of a Zod 4 schema definition these helpers read.
type ZodDefLike = {
  type: string;
  coerce?: boolean;
  in?: ZodNode;
  checks?: Array<{ _zod: { def: { check: string } } }>;
  innerType?: ZodNode;
  shape?: Record<string, ZodNode>;
  element?: ZodNode;
  items?: ZodNode[];
  rest?: ZodNode | null;
  options?: ZodNode[];
  left?: ZodNode;
  right?: ZodNode;
  valueType?: ZodNode;
  getter?: () => ZodNode;
};

/** Result of checking a resume payload against the wait it resolves. */
export type ResumePayloadCheck =
  | { ok: true; value: unknown }
  | { ok: false; error: WorkflowResumeRejectedError };

// Keywords that `z.fromJSONSchema` turns back into the same check. Others,
// such as `pattern` (regex flags are lost), `format` or `propertyNames` (an
// enum of keys becomes exhaustive), can come back stricter than the schema
// they were generated from, so they are dropped.
const KEPT_KEYWORDS = new Set([
  '$schema',
  '$ref',
  '$defs',
  'title',
  'description',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'prefixItems',
  'anyOf',
  'allOf',
  'enum',
  'const',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
]);
// Bounds a rewrite such as `.trim()` applies to the rewritten value.
const BOUND_KEYWORDS = [
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
];
// Types JSON has no value for: a payload read back from the checkpoint can
// never match them unless they coerce.
const NON_JSON_TYPES = new Set([
  'date',
  'bigint',
  'symbol',
  'map',
  'set',
  'nan',
  'function',
  'file',
]);
// Wrappers whose input is their inner schema's input.
const WRAPPER_TYPES = new Set([
  'optional',
  'nullable',
  'nonoptional',
  'readonly',
  'default',
  'prefault',
  'promise',
]);

/**
 * Describe the payload a `suspend()` call accepts as a JSON Schema that can
 * be stored on its wait.
 *
 * JSON Schema cannot express everything a Zod schema checks, so the result is
 * relaxed until it never refuses a JSON payload the Zod schema accepts:
 * coerced, preprocessed and `catch` nodes accept anything, and keywords that
 * do not round-trip exactly are dropped. The Zod schema stays authoritative
 * when the action body reads the payload.
 *
 * @param schema The `accepts` schema passed to `suspend()`.
 * @returns The relaxed JSON Schema, or undefined when it cannot be generated.
 */
export function describeResumePayload(schema: ZodType): JsonSchema | undefined {
  try {
    return z.toJSONSchema(schema, {
      io: 'input',
      unrepresentable: 'any',
      override: ({ zodSchema, jsonSchema }) =>
        relaxNode(
          (zodSchema as unknown as { _zod: { def: ZodDefLike } })._zod.def,
          jsonSchema as JsonSchema,
        ),
    }) as JsonSchema;
  } catch {
    return undefined;
  }
}

/**
 * Report whether an `accepts` schema also accepts a resume without payload.
 * Its JSON Schema cannot say so, since JSON has no `undefined`.
 *
 * @param schema The `accepts` schema passed to `suspend()`.
 * @returns True when the schema accepts `undefined`, e.g. when it is optional.
 */
export function isPayloadOptional(schema: ZodType): boolean {
  const { optin, def } = (schema as unknown as ZodNode)._zod;

  // Zod marks `.default()` as "defaulted" and gives `z.undefined()` and
  // `z.void()` no optin, though both accept a missing payload.
  return (
    optin === 'optional' ||
    optin === 'defaulted' ||
    def.type === 'undefined' ||
    def.type === 'void'
  );
}

/**
 * List the parts of an `accepts` schema that no JSON payload can match.
 *
 * Payloads are read back from the checkpoint as JSON, so a type JSON cannot
 * carry, such as `z.date()`, refuses every payload: a `Date` resumes as its
 * ISO string. Parts that coerce, preprocess or catch their input are fine.
 *
 * @param schema The `accepts` schema passed to `suspend()`.
 * @returns One `<path> (<type>)` entry per offending part, in schema order.
 */
export function findNonJsonTypes(schema: ZodType): string[] {
  const found: string[] = [];
  const seen = new Set<ZodNode>();
  const visit = (node: ZodNode | null | undefined, path: string): void => {
    // Shared and recursive schemas are visited once.
    if (!node || seen.has(node)) {
      return;
    }

    seen.add(node);
    const def = node._zod.def;
    if (acceptsBeyondItsType(def)) {
      return;
    }

    if (NON_JSON_TYPES.has(def.type)) {
      found.push(`${path || '(root)'} (${def.type})`);

      return;
    }

    if (WRAPPER_TYPES.has(def.type)) {
      return visit(def.innerType, path);
    }

    switch (def.type) {
      case 'object':
        return Object.entries(def.shape ?? {}).forEach(([key, child]) =>
          visit(child, path ? `${path}.${key}` : key),
        );
      case 'record':
        return visit(def.valueType, `${path}.*`);
      case 'array':
        return visit(def.element, `${path}[]`);
      case 'tuple':
        def.items?.forEach((item, index) => visit(item, `${path}[${index}]`));

        return visit(def.rest, `${path}[]`);
      case 'union':
        return def.options?.forEach((option) => visit(option, path));
      case 'intersection':
        visit(def.left, path);

        return visit(def.right, path);
      case 'pipe':
        // The payload is the input of the pipe, e.g. the string of a codec.
        return visit(def.in, path);
      case 'lazy':
        return visit(def.getter?.(), path);
    }
  };

  visit(schema as unknown as ZodNode, '');

  return found;
}

/**
 * Check a resume payload against the wait it resolves, without running
 * anything.
 *
 * The payload is first normalized the way the checkpoint stores it, so the
 * check sees what the action body will read. A resume without payload stays
 * `undefined`, which a wait with `accepts` takes only when its payload is
 * optional.
 *
 * @param wait The wait the payload resolves.
 * @param resumeData The payload, as passed to `resume()`.
 * @returns The normalized payload, or why it is refused.
 */
export function checkResumePayload(
  wait: WaitInfo,
  resumeData: unknown,
): ResumePayloadCheck {
  let value: unknown;
  try {
    value = resumeData === undefined ? undefined : cloneAsJson(resumeData);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return {
      ok: false,
      error: new WorkflowResumeRejectedError(
        `Resume payload for wait "${wait.waitId}" cannot be stored as JSON (${reason}).`,
      ),
    };
  }

  if (!wait.accepts || (value === undefined && wait.payloadOptional)) {
    return { ok: true, value };
  }

  let schema: ZodType;
  try {
    schema = z.fromJSONSchema(wait.accepts);
  } catch {
    // Unreadable here; the action's own schema still checks the payload.
    return { ok: true, value };
  }

  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, value };
  }

  return {
    ok: false,
    error: rejectResumePayload(`wait "${wait.waitId}"`, result.error.issues),
  };
}

/**
 * Build the error refusing a payload that failed a schema.
 *
 * @param subject What the payload was meant for, used in the message.
 * @param issues The schema issues.
 * @returns The rejection error.
 */
export function rejectResumePayload(
  subject: string,
  issues: z.core.$ZodIssue[],
): WorkflowResumeRejectedError {
  const messages = issues.map(
    (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );

  return new WorkflowResumeRejectedError(
    `Resume payload for ${subject} was rejected: ${messages.join('; ')}`,
    { issues: messages },
  );
}

const relaxNode = (def: ZodDefLike, jsonSchema: JsonSchema): void => {
  if (acceptsBeyondItsType(def)) {
    for (const keyword of Object.keys(jsonSchema)) {
      delete jsonSchema[keyword];
    }

    return;
  }

  // `oneOf` refuses a payload matching several options; `anyOf` does not.
  if ('oneOf' in jsonSchema) {
    jsonSchema.anyOf = jsonSchema.oneOf;
    delete jsonSchema.oneOf;
  }

  for (const keyword of Object.keys(jsonSchema)) {
    if (!KEPT_KEYWORDS.has(keyword)) {
      delete jsonSchema[keyword];
    }
  }

  if (def.checks?.some((check) => check._zod.def.check === 'overwrite')) {
    for (const keyword of BOUND_KEYWORDS) {
      delete jsonSchema[keyword];
    }
  }
};
/** Nodes that accept inputs their JSON Schema type would refuse. */
const acceptsBeyondItsType = (def: ZodDefLike): boolean =>
  def.coerce === true ||
  def.type === 'catch' ||
  def.type === 'custom' ||
  (def.type === 'pipe' && def.in?._zod.def.type === 'transform');
