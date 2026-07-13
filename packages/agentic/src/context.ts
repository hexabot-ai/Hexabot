/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

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
 * - failed: an uncaught error bubbled out of a step or continuation.
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

export interface SuspensionOptions {
  key?: string;
  reason?: string;
  data?: unknown;
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
  readonly status: WorkflowRunStatus;
  readonly resumeData: unknown;
  /**
   * Suspends the currently running action and returns a promise that settles when the workflow resumes.
   *
   * @param options - Optional metadata describing why the suspension occurred.
   * @returns Promise resolved with the data supplied to {@link resume}.
   */
  suspend<T = unknown>(options?: SuspensionOptions): Promise<T>;
  /**
   * Reports whether the next {@link suspend} call in the currently running
   * action already has a recorded resume result. This happens during
   * deterministic replay of a resumed step: the action body re-executes and
   * `suspend()` resolves immediately with the recorded payload. Actions that
   * perform side effects before suspending must skip those side effects when
   * this returns `true`, otherwise they run once per resume.
   *
   * @param key - Optional user key matching the `key` passed to `suspend`.
   * @returns `true` when the upcoming suspension resolves from a recorded result.
   */
  hasRecordedResult(key?: string): boolean;
  resume(data?: unknown): void;
  getSnapshot(): WorkflowSnapshot;
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
   * Sets up the context and copies any initial state onto the instance.
   *
   * @param initialState - Optional properties to assign to the context instance.
   * @param eventEmitter - Optional workflow event emitter to expose to actions.
   */
  constructor(initialState: S) {
    this.state = (initialState ?? {}) as S;
  }

  /**
   * Snapshot the context state for telemetry or UI rendering.
   * Override to filter or reshape the exposed state.
   */
  snapshot(): Record<string, unknown> {
    return safeCloneRecord(this.state);
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
   * Attaches or detaches the runtime control object.
   *
   * @param control - Runtime control instance or `undefined` to detach.
   * @returns Nothing; the method mutates internal state.
   */
  attachWorkflowRuntime(control: WorkflowRuntimeControl | undefined): void {
    this._workflowControl = control;
  }
}

const safeCloneRecord = (
  value: Record<string, unknown>,
): Record<string, unknown> => {
  if (!value) {
    return {};
  }

  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value) as Record<string, unknown>;
    } catch {
      // Fall through to JSON clone below.
    }
  }

  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    const shallow: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry !== 'function') {
        shallow[key] = entry;
      }
    }

    return shallow;
  }
};
