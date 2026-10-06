/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { ZodType } from 'zod';

import type { SuspensionOptions, WorkflowRuntimeControl } from './context';
import { NonDeterministicWorkflowError } from './errors';
import {
  describeResumePayload,
  findNonJsonTypes,
  isPayloadOptional,
  rejectResumePayload,
} from './resume-payload';
import type { StepInfo } from './workflow-event-emitter';

const INDEX_KEY_PREFIX = 'index:';
const USER_KEY_PREFIX = 'key:';

/** A `suspend()` call the step executor has to turn into a wait. */
export type RuntimeSuspensionRequest = {
  suspendKey: string;
  reason?: string;
  data?: unknown;
  /** Relaxed JSON Schema of the payload the wait accepts. */
  accepts?: Record<string, unknown>;
  /** Set when the `accepts` schema also accepts a resume without payload. */
  payloadOptional?: boolean;
  /** Suspend results already resolved for this step, keyed by suspend key. */
  awaitResults: Record<string, unknown>;
};

/** Seed for a task body that re-runs after its wait was resolved. */
export type StepReplaySeed = {
  awaitResults: Record<string, unknown>;
  /** Suspension the re-run body is expected to reach again. */
  expected: { suspendKey: string; reason?: string };
};

type ActiveStep = {
  step: StepInfo;
  cursor: number;
  /** User keys already passed to `suspend()` by the current attempt. */
  usedKeys: Set<string>;
  awaitResults: Map<string, unknown>;
  expected?: { suspendKey: string; reason?: string; matched: boolean };
  pending: RuntimeSuspensionRequest[];
  waiter?: (request: RuntimeSuspensionRequest) => void;
};

/**
 * Suspension control for one concurrency scope of a run.
 *
 * Steps inside a scope run one at a time, so the scope tracks a single active
 * step. The root flow owns one scope and every parallel branch forks its own,
 * which is what lets concurrent branches suspend independently.
 */
export class RunnerRuntimeControl implements WorkflowRuntimeControl {
  private active?: ActiveStep;

  /**
   * Create the scope of a concurrent region such as a parallel branch.
   *
   * @returns A new, independent scope.
   */
  fork(): RunnerRuntimeControl {
    return new RunnerRuntimeControl();
  }

  /**
   * Mark a task step as running in this scope.
   *
   * @param step Instance step that is about to run its action.
   * @param options.seed Previously resolved suspend results when the body re-runs.
   */
  beginStep(step: StepInfo, options: { seed?: StepReplaySeed } = {}): void {
    this.active = {
      step,
      cursor: 0,
      usedKeys: new Set(),
      awaitResults: new Map(Object.entries(options.seed?.awaitResults ?? {})),
      expected: options.seed
        ? { ...options.seed.expected, matched: false }
        : undefined,
      pending: [],
    };
  }

  /**
   * Release the active step.
   *
   * @param options.completed True when the action body returned successfully.
   * @throws {NonDeterministicWorkflowError} When a re-run body completed
   * without reaching the suspension it was resumed from.
   */
  endStep(options: { completed?: boolean } = {}): void {
    const active = this.active;
    this.active = undefined;

    if (options.completed && active?.expected && !active.expected.matched) {
      throw new NonDeterministicWorkflowError(
        `Resumed step "${active.step.id}" completed without reaching ` +
          `suspension "${active.expected.suspendKey}".`,
      );
    }
  }

  /**
   * Wait for the active step's next `suspend()` call.
   *
   * @returns The next suspension request.
   */
  waitForSuspension(): Promise<RuntimeSuspensionRequest> {
    const active = this.active;
    if (!active) {
      throw new Error('No workflow step is running in this scope.');
    }

    const queued = active.pending.shift();
    if (queued) {
      return Promise.resolve(queued);
    }

    return new Promise((resolve) => {
      active.waiter = resolve;
    });
  }

  suspend<T = unknown>(options?: SuspensionOptions<T>): Promise<T> {
    const active = this.active;
    if (!active) {
      throw new Error(
        'workflow.suspend() can only be called while a workflow step is running.',
      );
    }

    if (options?.accepts) {
      assertJsonPayloadSchema(active, options.accepts);
    }

    if (options?.key) {
      // A reused key would resolve from the first call's answer on resume,
      // so the second call could never suspend.
      if (active.usedKeys.has(options.key)) {
        throw new Error(
          `workflow.suspend() key "${options.key}" is used more than once ` +
            `in step "${active.step.id}"; keys must be unique within an action body.`,
        );
      }

      active.usedKeys.add(options.key);
    }

    active.cursor += 1;
    const suspendKey = buildSuspendKey(active.cursor, options?.key);

    this.assertReplayExpectation(active, suspendKey, options?.reason);

    if (active.awaitResults.has(suspendKey)) {
      return resolveRecordedResult(active, suspendKey, options?.accepts);
    }

    const request: RuntimeSuspensionRequest = {
      suspendKey,
      reason: options?.reason,
      data: options?.data,
      awaitResults: Object.fromEntries(active.awaitResults),
    };
    if (options?.accepts) {
      request.accepts = describeResumePayload(options.accepts);
      if (isPayloadOptional(options.accepts)) {
        request.payloadOptional = true;
      }
    }
    const waiter = active.waiter;
    if (waiter) {
      active.waiter = undefined;
      waiter(request);
    } else {
      active.pending.push(request);
    }

    // Never settles: the step executor aborts this body, and resuming re-runs
    // it so that this call resolves from `awaitResults` instead.
    return new Promise<T>(() => undefined);
  }

  /**
   * Report whether the active step, re-run to resolve a wait, has reached
   * that wait's `suspend()` call. Only from then on has it read the payload,
   * and can it refuse it.
   *
   * @returns True once the resolved suspension was reached.
   */
  hasReachedResolvedSuspension(): boolean {
    return this.active?.expected?.matched ?? false;
  }

  hasRecordedResult(key?: string): boolean {
    const active = this.active;
    if (!active) {
      return false;
    }

    return active.awaitResults.has(buildSuspendKey(active.cursor + 1, key));
  }

  markSuspendCursor(): () => void {
    const active = this.active;
    if (!active) {
      return () => undefined;
    }

    const cursor = active.cursor;
    const usedKeys = new Set(active.usedKeys);

    return () => {
      // A rewind taken in a step that has ended must not touch the next one.
      if (this.active === active) {
        active.cursor = cursor;
        active.usedKeys = new Set(usedKeys);
      }
    };
  }

  private assertReplayExpectation(
    active: ActiveStep,
    suspendKey: string,
    reason?: string,
  ): void {
    const expected = active.expected;
    if (!expected || expected.matched) {
      return;
    }

    if (suspendKey === expected.suspendKey) {
      if (expected.reason !== undefined && reason !== expected.reason) {
        throw new NonDeterministicWorkflowError(
          `Resumed step "${active.step.id}" reached suspend "${suspendKey}" ` +
            `with reason "${reason ?? ''}", expected reason "${expected.reason}".`,
        );
      }

      expected.matched = true;

      return;
    }

    if (active.awaitResults.has(suspendKey)) {
      return;
    }

    throw new NonDeterministicWorkflowError(
      `Resumed step "${active.step.id}" reached unexpected suspend ` +
        `"${suspendKey}" before expected "${expected.suspendKey}".`,
    );
  }
}

/**
 * Refuse an `accepts` schema that no JSON payload can match: the wait it
 * opens could never be resumed, since payloads are read back as JSON.
 *
 * @throws {TypeError} Naming the parts of the schema JSON cannot carry.
 */
const assertJsonPayloadSchema = (active: ActiveStep, accepts: ZodType) => {
  const found = findNonJsonTypes(accepts);
  if (found.length === 0) {
    return;
  }

  throw new TypeError(
    `The accepts schema of workflow.suspend() in step "${active.step.id}" ` +
      `can never match a JSON payload: ${found.join(', ')}. Resume payloads ` +
      'are stored as JSON, so accept their JSON form instead, e.g. ' +
      'z.coerce.date() or z.iso.datetime() for a date.',
  );
};
/**
 * Resolve a `suspend()` call from its recorded result, parsed through the
 * call's `accepts` schema when it has one.
 *
 * @returns The recorded (or parsed) result. It rejects with a
 * `WorkflowResumeRejectedError` when the payload this pass resolved fails the
 * schema, and with a {@link NonDeterministicWorkflowError} when a result
 * accepted by an earlier pass no longer does.
 */
const resolveRecordedResult = async <T>(
  active: ActiveStep,
  suspendKey: string,
  accepts?: ZodType<T>,
): Promise<T> => {
  const recorded = active.awaitResults.get(suspendKey);
  if (!accepts) {
    return recorded as T;
  }

  const parsed = await accepts.safeParseAsync(recorded);
  if (parsed.success) {
    return parsed.data;
  }

  if (suspendKey === active.expected?.suspendKey) {
    throw rejectResumePayload(`step "${active.step.id}"`, parsed.error.issues);
  }

  throw new NonDeterministicWorkflowError(
    `Resumed step "${active.step.id}" recorded a result for suspend ` +
      `"${suspendKey}" that no longer matches its accepts schema.`,
  );
};
const buildSuspendKey = (suspendIndex: number, key?: string): string => {
  if (key) {
    return `${USER_KEY_PREFIX}${key}`;
  }

  return `${INDEX_KEY_PREFIX}${suspendIndex}`;
};
