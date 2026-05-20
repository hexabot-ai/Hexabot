/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Expression, Focus } from 'jsonata';
import jsonata from 'jsonata';

import type { JsonValue, Settings } from './dsl.types';
import type {
  CompiledMapping,
  CompiledValue,
  EvaluationScope,
} from './workflow-types';

export type JsonataFunctionImplementation = (
  this: Focus,
  ...args: any[]
) => unknown;

export type JsonataFunctionConfig =
  | JsonataFunctionImplementation
  | {
      implementation: JsonataFunctionImplementation;
      signature?: string;
    };

export type JsonataFunctionRegistry = Record<string, JsonataFunctionConfig>;

export type CompileValueOptions = {
  jsonataFunctions?: JsonataFunctionRegistry;
};

/** Basic object guard that rejects arrays and null. */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const resolveNestedExpressions = async (
  value: unknown,
  scope: EvaluationScope,
  seen: WeakSet<object> = new WeakSet(),
): Promise<unknown> => {
  if (typeof value === 'string' && value.startsWith('=')) {
    return evaluateValue(compileValue(value), scope);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);

    return Promise.all(
      value.map((entry) => resolveNestedExpressions(entry, scope, seen)),
    );
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);

    const entries = await Promise.all(
      Object.entries(value).map(async ([key, entry]) => [
        key,
        await resolveNestedExpressions(entry, scope, seen),
      ]),
    );

    return Object.fromEntries(entries);
  }

  return value;
};
const registerJsonataFunctions = (
  expression: Expression,
  registry?: JsonataFunctionRegistry,
) => {
  if (!registry) {
    return;
  }

  for (const [name, config] of Object.entries(registry)) {
    if (typeof config === 'function') {
      expression.registerFunction(name, config);
      continue;
    }

    if (config && typeof config.implementation === 'function') {
      expression.registerFunction(
        name,
        config.implementation,
        config.signature,
      );
      continue;
    }

    throw new Error(`Invalid JSONata function config for "${name}"`);
  }
};

/**
 * Prepares a workflow value for evaluation.
 * Strings prefixed with `=` are treated as JSONata expressions; everything else is a literal.
 */
export const compileValue = (
  value: unknown,
  options?: CompileValueOptions,
): CompiledValue => {
  if (typeof value === 'string' && value.startsWith('=')) {
    const expression = jsonata(value.slice(1));
    registerJsonataFunctions(expression, options?.jsonataFunctions);

    return { kind: 'expression', source: value, expression };
  }

  return { kind: 'literal', value };
};

/**
 * Evaluate a compiled value against the current workflow scope.
 * Expressions are executed via JSONata with the scope exposed as variables; `context`
 * represents the workflow context state, not the context instance itself.
 */
export const evaluateValue = async (
  compiled: CompiledValue,
  scope: EvaluationScope,
): Promise<unknown> => {
  if (compiled.kind === 'literal') {
    return compiled.value;
  }

  return compiled.expression.evaluate(
    {},
    {
      input: scope.input,
      context: scope.context,
      output: scope.output,
      iteration: scope.iteration,
      accumulator: scope.accumulator,
      result: scope.result,
    },
  );
};

/**
 * Evaluate all entries of a compiled mapping, returning a plain object.
 * Missing mappings resolve to an empty object.
 */
export const evaluateMapping = async (
  mapping: CompiledMapping | undefined,
  scope: EvaluationScope,
): Promise<Record<string, unknown>> => {
  if (!mapping) {
    return {};
  }

  const entries = await Promise.all(
    Object.entries(mapping).map(async ([key, compiled]) => [
      key,
      await resolveNestedExpressions(
        await evaluateValue(compiled, scope),
        scope,
      ),
    ]),
  );
  const result: Record<string, unknown> = Object.fromEntries(entries);

  return result;
};

/**
 * Deep-merge workflow settings, preferring non-undefined overrides.
 * Nested objects are merged recursively to preserve defaults.
 */
export const mergeSettings = (
  base?: Partial<Settings>,
  override?: Partial<Settings>,
): Partial<Settings> => {
  const merged: Partial<Settings> = { ...(base ?? {}) };

  if (!override) {
    return merged;
  }

  for (const key of Object.keys(override)) {
    const value = override[key];
    const previous = merged[key];

    if (isPlainObject(previous) && isPlainObject(value)) {
      merged[key] = mergeSettings(
        previous as Partial<Settings>,
        value as Partial<Settings>,
      ) as JsonValue;
    } else if (value !== undefined) {
      merged[key] = value;
    }
  }

  return merged;
};
