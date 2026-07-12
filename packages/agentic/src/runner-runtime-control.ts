/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type {
  SuspensionOptions,
  WorkflowRunStatus,
  WorkflowRuntimeControl,
} from './context';
import type { Deferred } from './utils/deferred';
import { createDeferred } from './utils/deferred';
import type { WorkflowRunner } from './workflow-runner';

const INDEX_KEY_PREFIX = 'index:';
const USER_KEY_PREFIX = 'key:';

type ReplayExpectation = {
  suspendIndex?: number;
  suspendKey: string;
  reason?: string;
  matched: boolean;
};

type StepExecutionState = {
  stepId: string;
  stepExecId: string;
  suspendCursor: number;
  awaitResults: Map<string, unknown>;
  replayExpectation?: ReplayExpectation;
};

type StoredReplaySeed = {
  stepExecId: string;
  awaitResults: Record<string, unknown>;
  activeSuspension?: {
    suspendIndex?: number;
    suspendKey?: string;
    reason?: string;
  };
};

export type RuntimeSuspensionRequest = {
  stepId: string;
  stepExecId: string;
  suspendIndex: number;
  suspendKey: string;
  reason?: string;
  data?: unknown;
  awaitResults: Record<string, unknown>;
  resume: Deferred<unknown>;
};

export type RuntimeStepReplaySeed = {
  stepId: string;
  stepExecId: string;
  awaitResults?: Record<string, unknown>;
  activeSuspension?: {
    suspendIndex?: number;
    suspendKey?: string;
    reason?: string;
  };
};

export type RuntimeResolvedSuspension = {
  stepId: string;
  resumeData: unknown;
  stepExecId?: string;
  suspendIndex?: number;
  suspendKey?: string;
};

export class NonDeterministicWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonDeterministicWorkflowError';
  }
}

/** Minimal wrapper that exposes runner controls to actions via the context. */
export class RunnerRuntimeControl implements WorkflowRuntimeControl {
  private readonly runner: WorkflowRunner;

  private readonly pendingSuspensions = new Map<
    string,
    RuntimeSuspensionRequest[]
  >();

  private readonly suspensionWaiters = new Map<
    string,
    Array<(request: RuntimeSuspensionRequest) => void>
  >();

  private readonly primedResumeData = new Map<string, unknown[]>();

  private readonly stepAttempts = new Map<string, number>();

  private readonly activeStepExecutions = new Map<string, StepExecutionState>();

  private readonly replaySeeds = new Map<string, StoredReplaySeed>();

  constructor(runner: WorkflowRunner) {
    this.runner = runner;
  }

  get status(): WorkflowRunStatus {
    return this.runner.getStatus();
  }

  get resumeData(): unknown {
    return this.runner.getLastResumeData();
  }

  suspend<T = unknown>(options?: SuspensionOptions): Promise<T> {
    const currentStep = this.runner.getCurrentStep();
    if (!currentStep) {
      throw new Error(
        'workflow.suspend() can only be called while a workflow step is running.',
      );
    }

    const execution = this.ensureStepExecution(currentStep.id);

    execution.suspendCursor += 1;
    const suspendIndex = execution.suspendCursor;
    const suspendKey = buildSuspendKey(suspendIndex, options?.key);

    this.assertReplayExpectation(execution, {
      suspendIndex,
      suspendKey,
      reason: options?.reason,
    });

    if (execution.awaitResults.has(suspendKey)) {
      return Promise.resolve(execution.awaitResults.get(suspendKey) as T);
    }

    const primed = this.dequeuePrimedResumeData(currentStep.id);
    if (primed.found) {
      return Promise.resolve(primed.value as T);
    }

    const request: RuntimeSuspensionRequest = {
      stepId: currentStep.id,
      stepExecId: execution.stepExecId,
      suspendIndex,
      suspendKey,
      reason: options?.reason,
      data: options?.data,
      awaitResults: this.serializeAwaitResults(execution.awaitResults),
      resume: createDeferred<unknown>(),
    };

    this.enqueueSuspension(request);

    return request.resume.promise as Promise<T>;
  }

  hasRecordedResult(key?: string): boolean {
    const currentStep = this.runner.getCurrentStep();
    if (!currentStep) {
      return false;
    }

    const execution = this.ensureStepExecution(currentStep.id);
    const suspendKey = buildSuspendKey(execution.suspendCursor + 1, key);
    if (execution.awaitResults.has(suspendKey)) {
      return true;
    }

    return (this.primedResumeData.get(currentStep.id)?.length ?? 0) > 0;
  }

  resume(data?: unknown): void {
    void this.runner.resume({ resumeData: data });
  }

  waitForStepSuspension(stepId: string): Promise<RuntimeSuspensionRequest> {
    const queued = this.dequeueStepSuspension(stepId);
    if (queued) {
      return Promise.resolve(queued);
    }

    return new Promise((resolve) => {
      const waiters = this.suspensionWaiters.get(stepId) ?? [];

      waiters.push(resolve);
      this.suspensionWaiters.set(stepId, waiters);
    });
  }

  beginStepExecution(stepId: string): string {
    const existing = this.activeStepExecutions.get(stepId);
    if (existing) {
      return existing.stepExecId;
    }

    const seeded = this.replaySeeds.get(stepId);
    if (seeded) {
      const execution: StepExecutionState = {
        stepId,
        stepExecId: seeded.stepExecId,
        suspendCursor: 0,
        awaitResults: this.normalizeAwaitResults(seeded.awaitResults),
        replayExpectation: seeded.activeSuspension
          ? {
              suspendIndex: seeded.activeSuspension.suspendIndex,
              suspendKey:
                normalizeSuspendKey(
                  seeded.activeSuspension.suspendIndex,
                  seeded.activeSuspension.suspendKey,
                ) ?? buildSuspendKey(seeded.activeSuspension.suspendIndex ?? 1),
              reason: seeded.activeSuspension.reason,
              matched: false,
            }
          : undefined,
      };

      this.activeStepExecutions.set(stepId, execution);
      this.replaySeeds.delete(stepId);
      this.bumpStepAttemptCounter(stepId, execution.stepExecId);

      return execution.stepExecId;
    }

    const attempt = (this.stepAttempts.get(stepId) ?? 0) + 1;
    const stepExecId = `${stepId}#${attempt}`;
    this.stepAttempts.set(stepId, attempt);
    this.activeStepExecutions.set(stepId, {
      stepId,
      stepExecId,
      suspendCursor: 0,
      awaitResults: new Map<string, unknown>(),
    });

    return stepExecId;
  }

  prepareStepReplay(seed: RuntimeStepReplaySeed): void {
    const normalizedAwaitResults = this.serializeAwaitResults(
      this.normalizeAwaitResults(seed.awaitResults ?? {}),
    );

    this.replaySeeds.set(seed.stepId, {
      stepExecId: seed.stepExecId,
      awaitResults: normalizedAwaitResults,
      activeSuspension: seed.activeSuspension
        ? {
            suspendIndex: seed.activeSuspension.suspendIndex,
            suspendKey: normalizeSuspendKey(
              seed.activeSuspension.suspendIndex,
              seed.activeSuspension.suspendKey,
            ),
            reason: seed.activeSuspension.reason,
          }
        : undefined,
    });
    this.bumpStepAttemptCounter(seed.stepId, seed.stepExecId);
  }

  recordStepSuspendResult(params: RuntimeResolvedSuspension): void {
    const suspendKey = normalizeSuspendKey(
      params.suspendIndex,
      params.suspendKey,
    );

    if (!suspendKey) {
      this.primeStepResumeData(params.stepId, params.resumeData);

      return;
    }

    const activeExecution = this.activeStepExecutions.get(params.stepId);
    if (
      activeExecution &&
      (!params.stepExecId || params.stepExecId === activeExecution.stepExecId)
    ) {
      if (!activeExecution.awaitResults.has(suspendKey)) {
        activeExecution.awaitResults.set(suspendKey, params.resumeData);
      }

      return;
    }

    const replaySeed = this.replaySeeds.get(params.stepId);
    if (replaySeed) {
      if (params.stepExecId && replaySeed.stepExecId !== params.stepExecId) {
        return;
      }

      replaySeed.awaitResults[suspendKey] =
        replaySeed.awaitResults[suspendKey] ?? params.resumeData;
      this.replaySeeds.set(params.stepId, replaySeed);

      return;
    }

    const fallbackExecId = params.stepExecId ?? `${params.stepId}#1`;
    this.replaySeeds.set(params.stepId, {
      stepExecId: fallbackExecId,
      awaitResults: { [suspendKey]: params.resumeData },
    });
    this.bumpStepAttemptCounter(params.stepId, fallbackExecId);
  }

  clearStepSuspensions(stepId: string, error?: unknown): void {
    const queued = this.pendingSuspensions.get(stepId);
    if (queued) {
      for (const request of queued) {
        request.resume.reject(
          error ?? new Error(`Suspension for step "${stepId}" was cancelled.`),
        );
      }
    }

    const execution = this.activeStepExecutions.get(stepId);

    this.pendingSuspensions.delete(stepId);
    this.suspensionWaiters.delete(stepId);
    this.primedResumeData.delete(stepId);
    this.activeStepExecutions.delete(stepId);

    if (
      !error &&
      execution?.replayExpectation &&
      !execution.replayExpectation.matched
    ) {
      throw new NonDeterministicWorkflowError(
        `Replay for step "${stepId}" did not reach expected suspension ` +
          `"${execution.replayExpectation.suspendKey}".`,
      );
    }
  }

  primeStepResumeData(stepId: string, resumeData: unknown): void {
    const queued = this.primedResumeData.get(stepId) ?? [];

    queued.push(resumeData);
    this.primedResumeData.set(stepId, queued);
  }

  getSnapshot() {
    return this.runner.getSnapshot();
  }

  private enqueueSuspension(request: RuntimeSuspensionRequest): void {
    const waiters = this.suspensionWaiters.get(request.stepId);
    if (waiters && waiters.length > 0) {
      const resolve = waiters.shift();
      if (!resolve) {
        return;
      }

      if (waiters.length === 0) {
        this.suspensionWaiters.delete(request.stepId);
      } else {
        this.suspensionWaiters.set(request.stepId, waiters);
      }

      resolve(request);

      return;
    }

    const queued = this.pendingSuspensions.get(request.stepId) ?? [];

    queued.push(request);
    this.pendingSuspensions.set(request.stepId, queued);
  }

  private dequeueStepSuspension(
    stepId: string,
  ): RuntimeSuspensionRequest | undefined {
    const queued = this.pendingSuspensions.get(stepId);
    if (!queued || queued.length === 0) {
      return undefined;
    }

    const request = queued.shift();
    if (queued.length === 0) {
      this.pendingSuspensions.delete(stepId);
    } else {
      this.pendingSuspensions.set(stepId, queued);
    }

    return request;
  }

  private dequeuePrimedResumeData(stepId: string): {
    found: boolean;
    value?: unknown;
  } {
    const queued = this.primedResumeData.get(stepId);
    if (!queued || queued.length === 0) {
      return { found: false };
    }

    const value = queued.shift();
    if (queued.length === 0) {
      this.primedResumeData.delete(stepId);
    } else {
      this.primedResumeData.set(stepId, queued);
    }

    return { found: true, value };
  }

  private ensureStepExecution(stepId: string): StepExecutionState {
    const existing = this.activeStepExecutions.get(stepId);
    if (existing) {
      return existing;
    }

    this.beginStepExecution(stepId);

    const created = this.activeStepExecutions.get(stepId);
    if (!created) {
      throw new Error(`Unable to create runtime state for step "${stepId}".`);
    }

    return created;
  }

  private assertReplayExpectation(
    execution: StepExecutionState,
    encountered: { suspendIndex: number; suspendKey: string; reason?: string },
  ): void {
    const expectation = execution.replayExpectation;
    if (!expectation || expectation.matched) {
      return;
    }

    if (encountered.suspendKey === expectation.suspendKey) {
      if (
        expectation.reason !== undefined &&
        encountered.reason !== expectation.reason
      ) {
        throw new NonDeterministicWorkflowError(
          `Replay for step "${execution.stepId}" reached suspend ` +
            `"${encountered.suspendKey}" with reason "${encountered.reason ?? ''}", ` +
            `expected reason "${expectation.reason}".`,
        );
      }

      expectation.matched = true;

      return;
    }

    if (execution.awaitResults.has(encountered.suspendKey)) {
      return;
    }

    throw new NonDeterministicWorkflowError(
      `Replay for step "${execution.stepId}" reached unexpected suspend ` +
        `"${encountered.suspendKey}" before expected ` +
        `"${expectation.suspendKey}".`,
    );
  }

  private normalizeAwaitResults(
    awaitResults: Record<string, unknown>,
  ): Map<string, unknown> {
    const normalized = new Map<string, unknown>();

    for (const [rawKey, value] of Object.entries(awaitResults)) {
      const normalizedKey = normalizeStoredSuspendKey(rawKey);
      normalized.set(normalizedKey, value);
    }

    return normalized;
  }

  private serializeAwaitResults(
    awaitResults: Map<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(awaitResults.entries());
  }

  private bumpStepAttemptCounter(stepId: string, stepExecId: string): void {
    const parsedAttempt = parseStepExecAttempt(stepId, stepExecId);
    if (parsedAttempt === null) {
      return;
    }

    const previous = this.stepAttempts.get(stepId) ?? 0;
    if (parsedAttempt > previous) {
      this.stepAttempts.set(stepId, parsedAttempt);
    }
  }
}

const buildSuspendKey = (suspendIndex: number, key?: string): string => {
  if (key) {
    return `${USER_KEY_PREFIX}${key}`;
  }

  return `${INDEX_KEY_PREFIX}${suspendIndex}`;
};
const normalizeSuspendKey = (
  suspendIndex?: number,
  suspendKey?: string,
): string | undefined => {
  if (typeof suspendKey === 'string' && suspendKey.length > 0) {
    if (
      suspendKey.startsWith(INDEX_KEY_PREFIX) ||
      suspendKey.startsWith(USER_KEY_PREFIX)
    ) {
      return suspendKey;
    }

    if (/^\d+$/.test(suspendKey)) {
      return `${INDEX_KEY_PREFIX}${suspendKey}`;
    }

    return `${USER_KEY_PREFIX}${suspendKey}`;
  }

  if (
    typeof suspendIndex === 'number' &&
    Number.isInteger(suspendIndex) &&
    suspendIndex > 0
  ) {
    return `${INDEX_KEY_PREFIX}${suspendIndex}`;
  }

  return undefined;
};
const normalizeStoredSuspendKey = (rawKey: string): string => {
  if (
    rawKey.startsWith(INDEX_KEY_PREFIX) ||
    rawKey.startsWith(USER_KEY_PREFIX)
  ) {
    return rawKey;
  }

  if (/^\d+$/.test(rawKey)) {
    return `${INDEX_KEY_PREFIX}${rawKey}`;
  }

  return `${USER_KEY_PREFIX}${rawKey}`;
};
const parseStepExecAttempt = (
  stepId: string,
  stepExecId: string,
): number | null => {
  const prefix = `${stepId}#`;
  if (!stepExecId.startsWith(prefix)) {
    return null;
  }

  const numeric = Number.parseInt(stepExecId.slice(prefix.length), 10);
  if (Number.isNaN(numeric) || numeric < 1) {
    return null;
  }

  return numeric;
};
