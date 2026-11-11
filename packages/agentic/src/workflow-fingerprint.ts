/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { StepType } from './workflow-event-emitter';
import type {
  CompiledMapping,
  CompiledStep,
  CompiledValue,
  CompiledWorkflow,
  LoopStep,
} from './workflow-types';

/** Separator between fingerprint parts; never produced by the parts themselves. */
const PART_SEPARATOR = '~|~';
/** Fingerprints are pure functions of the compiled graph, so compute each once. */
const fingerprintCache = new WeakMap<CompiledWorkflow, string>();

/**
 * Fingerprint the parts of a compiled workflow that a checkpoint depends on.
 *
 * Hashing step ids alone is not enough: a changed `until`, `while`, branch
 * condition or `inputs` mapping keeps every id stable while changing what the
 * resumed run actually does. Labels are included because `buildStepId`
 * embeds them, so renaming a task changes every downstream step id.
 *
 * @param compiled The compiled workflow to fingerprint.
 * @returns A short, stable hash of the resume-relevant definition surface.
 */
export const fingerprintWorkflow = (compiled: CompiledWorkflow): string => {
  const cached = fingerprintCache.get(compiled);
  if (cached !== undefined) {
    return cached;
  }

  const parts: string[] = [];

  collectSteps(compiled, compiled.flow, parts);
  parts.push('outputs', ...describeMapping(compiled.outputMapping));

  const fingerprint = hash(parts.join(PART_SEPARATOR));
  fingerprintCache.set(compiled, fingerprint);

  return fingerprint;
};

/**
 * Append a canonical description of each step, depth first.
 *
 * @param compiled The compiled workflow, used to resolve task definitions.
 * @param steps Steps to describe.
 * @param parts Accumulator receiving the description fragments.
 */
const collectSteps = (
  compiled: CompiledWorkflow,
  steps: CompiledStep[],
  parts: string[],
): void => {
  for (const step of steps) {
    parts.push(step.type, step.id, step.label);

    switch (step.type) {
      case StepType.Task: {
        const task = compiled.tasks[step.taskName];

        parts.push(step.taskName, task?.actionName ?? '');
        parts.push(...describeMapping(task?.inputs));
        break;
      }
      case StepType.Parallel:
        parts.push(step.strategy);
        collectSteps(compiled, step.steps, parts);
        break;
      case StepType.Conditional:
        for (const branch of step.branches) {
          parts.push(branch.id, describeValue(branch.condition));
          collectSteps(compiled, branch.steps, parts);
        }
        break;
      case StepType.Loop:
        parts.push(...describeLoop(step));
        collectSteps(compiled, step.steps, parts);
        break;
    }
  }
};
/**
 * Describe what drives a loop: its kind, name, accumulator, and items or
 * condition.
 *
 * @param step The loop step.
 * @returns The description fragments, in a fixed order.
 */
const describeLoop = (step: LoopStep): string[] => [
  step.loopType,
  step.name ?? '',
  step.accumulate
    ? `${step.accumulate.as}=${stringify(step.accumulate.initial)}:${describeValue(step.accumulate.merge)}`
    : '',
  ...(step.loopType === 'for_each'
    ? [
        step.forEach.item,
        describeValue(step.forEach.in),
        describeValue(step.until),
      ]
    : [describeValue(step.while)]),
];
/**
 * Describe a compiled mapping in a key-stable order.
 *
 * @param mapping The mapping to describe.
 * @returns One fragment per mapped key.
 */
const describeMapping = (mapping?: CompiledMapping): string[] => {
  if (!mapping) {
    return [];
  }

  return Object.keys(mapping)
    .sort()
    .map((key) => `${key}=${describeValue(mapping[key])}`);
};
/**
 * Describe a compiled value by its authored source, not its compiled form.
 *
 * @param value The compiled value.
 * @returns A stable textual description.
 */
const describeValue = (value?: CompiledValue): string => {
  if (!value) {
    return '';
  }

  return value.kind === 'expression'
    ? `=${value.source}`
    : stringify(value.value);
};
const stringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};
/**
 * Hash a string with two FNV-1a style passes under different constants.
 *
 * Kept dependency-free on purpose: the package is consumed from browser
 * bundles, so `node:crypto` is not available.
 *
 * @param value The canonical description to hash.
 * @returns A 16-character hexadecimal digest.
 */
const hash = (value: string): string => {
  let low = 0x811c9dc5;
  let high = 0x01000193;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    low ^= code;
    low = Math.imul(low, 0x01000193) >>> 0;
    high ^= code + index;
    high = Math.imul(high, 0x85ebca6b) >>> 0;
  }

  return `${low.toString(16).padStart(8, '0')}${high.toString(16).padStart(8, '0')}`;
};
