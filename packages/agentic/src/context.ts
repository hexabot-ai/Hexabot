/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { ZodType } from 'zod';

import { cloneRecord } from './utils/clone';
import type {
  EventEmitterLike,
  WorkflowEventEmitterLike,
} from './workflow-event-emitter';

/**
 * Lifecycle of a workflow run:
 * - idle: runner constructed but `start` not invoked.
 * - running: set when `start` or `resume` begins executing steps.
 * - suspended: an action awaited `workflow.suspend`; `resume` moves back to running.
 * - finished: all steps completed and outputs were evaluated successfully.
 * - failed: an uncaught error bubbled out of a step or the output mapping.
 */
export enum EWorkflowRunStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  SUSPENDED = 'suspended',
  FINISHED = 'finished',
  FAILED = 'failed',
}

export type WorkflowRunStatus = `${EWorkflowRunStatus}`;

export const WORKFLOW_RUN_STATUSES: WorkflowRunStatus[] = [
  EWorkflowRunStatus.IDLE,
  EWorkflowRunStatus.RUNNING,
  EWorkflowRunStatus.SUSPENDED,
  EWorkflowRunStatus.FINISHED,
  EWorkflowRunStatus.FAILED,
];

/**
 * Lifecycle of an individual action/step captured in snapshots:
 * - pending: defined but not yet executed (default before runner touches the step).
 * - running: inputs evaluated and action invoked.
 * - suspended: action paused via `workflow.suspend`; resumes to completed.
 * - completed: action resolved (either immediately or after resume).
 * - failed: action threw an error.
 * - cancelled: action was aborted by the workflow scheduler.
 * - skipped: control flow bypassed the step (e.g., alternate branch or wait_any short-circuit).
 */
export type ActionStatus =
  | 'pending'
  | 'running'
  | 'suspended'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export interface SuspensionOptions<T = unknown> {
  key?: string;
  reason?: string;
  data?: unknown;
  /**
   * Schema the resume payload must match. It is stored on the wait as a
   * relaxed JSON Schema, so hosts can refuse a bad payload before resuming,
   * and the payload `suspend()` resolves with is parsed through it. A payload
   * that fails it is refused and the wait stays open.
   *
   * The payload is parsed in its JSON form, as the checkpoint stores it: a
   * `Date` arrives as its ISO string. `suspend()` throws when part of the
   * schema is a type JSON cannot carry, such as `z.date()`; accept the JSON
   * form instead, e.g. `z.coerce.date()` or `z.iso.datetime()`.
   */
  accepts?: ZodType<T>;
}

export interface ActionSnapshot {
  id: string;
  name: string;
  status: ActionStatus;
  reason?: string;
}

export type StepExecutionRecord = {
  id: string;
  name: string;
  action?: string;
  status: ActionStatus;
  startedAt?: number;
  endedAt?: number;
  input?: unknown;
  output?: unknown;
  context?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
  error?: { message: string; stack?: string };
  reason?: string;
};

export interface WorkflowSnapshot {
  status: WorkflowRunStatus;
  actions: Record<string, ActionSnapshot>;
}

export interface WorkflowRuntimeControl {
  /**
   * Suspends the currently running action and returns a promise that settles when the workflow resumes.
   *
   * @param options - Optional metadata describing why the suspension occurred.
   * @returns Promise resolved with the JSON copy of the payload the run was
   * resumed with, or `undefined` when it was resumed without one; parsed
   * through `options.accepts` when given. It rejects with a
   * `WorkflowResumeRejectedError` when that payload fails `options.accepts`.
   * @throws {TypeError} When `options.accepts` uses a type JSON cannot carry.
   */
  suspend<T = unknown>(options?: SuspensionOptions<T>): Promise<T>;
  /**
   * Reports whether the next {@link suspend} call in the currently running
   * action already has a recorded resume result. This happens when a resumed
   * step re-runs its action body from the top: `suspend()` calls it already
   * made resolve immediately with their recorded payloads. Actions that
   * perform side effects before suspending must skip those side effects when
   * this returns `true`, otherwise they run once per resume.
   *
   * @param key - Optional user key matching the `key` passed to `suspend`.
   * @returns `true` when the upcoming suspension resolves from a recorded result.
   */
  hasRecordedResult(key?: string): boolean;
  /**
   * Record where the running step's suspend cursor stands, before an action
   * run starts its attempts.
   *
   * Suspend keys are positional within a body, so whoever retries a body
   * must rewind the cursor before each attempt: the retry then reproduces the
   * keys of the first attempt and resolves from the recorded results, instead
   * of suspending on new ones. {@link AbstractAction} does this; an action
   * with its own retry loop should too. The rewind point is where the run
   * started, so an action run nested inside a body never rewinds the body.
   *
   * @returns A function rewinding the cursor to the recorded position. It
   * does nothing once the step has ended.
   */
  markSuspendCursor?(): () => void;
}

/**
 * Base context that is threaded through every workflow execution.
 *
 * Extend this class in user-land to expose shared services such as loggers,
 * event emitters, database connections, or feature flags.
 */
export abstract class BaseWorkflowContext<
  S extends Record<string, unknown> = Record<string, unknown>,
  E = EventEmitterLike,
> {
  public state: S;

  private _workflowControl?: WorkflowRuntimeControl;

  public abstract eventEmitter: WorkflowEventEmitterLike<E>;

  /**
   * Sets up the context with its initial state.
   *
   * @param initialState - State exposed to expressions as `$context`.
   */
  constructor(initialState: S) {
    this.state = (initialState ?? {}) as S;
  }

  /**
   * Snapshot the context state for telemetry or UI rendering.
   * Override to filter or reshape the exposed state.
   */
  snapshot(): Record<string, unknown> {
    return cloneRecord(this.state ?? {});
  }

  /**
   * Provides access to the workflow runtime API for the current execution.
   *
   * @returns Runtime control methods that allow suspension and inspection.
   * @throws Error when the context is not currently attached to a runner.
   */
  get workflow(): WorkflowRuntimeControl {
    if (!this._workflowControl) {
      throw new Error('Workflow runtime is not attached to this context.');
    }

    return this._workflowControl;
  }

  /**
   * Reads the runtime control without throwing when none is attached.
   *
   * @returns The attached runtime control, or `undefined` outside a run.
   */
  getWorkflowRuntime(): WorkflowRuntimeControl | undefined {
    return this._workflowControl;
  }

  /**
   * Attaches or detaches the runtime control object.
   *
   * @param control - Runtime control instance or `undefined` to detach.
   * @returns Nothing; the method mutates internal state.
   */
  attachWorkflowRuntime(control: WorkflowRuntimeControl | undefined): void {
    this._workflowControl = control;
  }
}
