/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WaitInfo } from './checkpoint';
import type { StepExecutionRecord } from './context';
import type { WorkflowResumeRejectedError } from './errors';

export enum StepType {
  Task = 'task',
  Parallel = 'parallel',
  Conditional = 'conditional',
  Loop = 'loop',
}

export type StepInfo = {
  id: string;
  name: string;
  type: StepType;
};

export type StepWorkflowEventPayload = {
  runId?: string;
  step: StepInfo;
  stepExecution?: StepExecutionRecord;
};

export type WorkflowEventMap = {
  'hook:workflow:start': { runId?: string };
  'hook:workflow:finish': { runId?: string; output: Record<string, unknown> };
  'hook:workflow:failure': { runId?: string; error: unknown };
  'hook:workflow:suspended': {
    runId?: string;
    /** Every open wait of the run, in flow order. */
    waits: WaitInfo[];
  };
  /** A resume payload was refused; the run is unchanged and the wait stays open. */
  'hook:workflow:resume_rejected': {
    runId?: string;
    /** The wait the payload was meant for. */
    wait: WaitInfo;
    /** The payload as passed to `resume()`. */
    resumeData: unknown;
    error: WorkflowResumeRejectedError;
  };
  'hook:step:start': StepWorkflowEventPayload;
  /** A suspended step whose wait was resolved re-runs its action body. */
  'hook:step:resumed': StepWorkflowEventPayload & {
    /** The wait this resume resolved. */
    wait: WaitInfo;
    /** The payload recorded for the wait, after its JSON round trip. */
    resumeData: unknown;
  };
  /** A resumed step refused its payload and is suspended again on the same wait. */
  'hook:step:resume_rejected': StepWorkflowEventPayload & {
    wait: WaitInfo;
    error: WorkflowResumeRejectedError;
  };
  'hook:step:success': StepWorkflowEventPayload;
  'hook:step:error': StepWorkflowEventPayload & { error: unknown };
  'hook:step:cancelled': StepWorkflowEventPayload & {
    error: unknown;
    /** The wait the step was suspended on, which is now dropped. */
    wait?: WaitInfo;
  };
  'hook:step:suspended': StepWorkflowEventPayload & {
    /** The wait this suspension opened. */
    wait: WaitInfo;
  };
  'hook:step:skipped': { runId?: string; step: StepInfo; reason?: string };
};

export type EventEmitterLike = {
  emit(event: string | symbol, ...args: any[]): unknown;
  on(event: string | symbol, listener: (...args: any[]) => void): unknown;
};

export type WorkflowEventEmitterLike<E = unknown> = E & EventEmitterLike;

type EventKey = keyof WorkflowEventMap;
type AnyListener = (payload: WorkflowEventMap[EventKey]) => void;

/**
 * Minimal, browser-friendly event emitter that preserves the typed payloads
 * exposed by {@link WorkflowEventMap}. It supports the subset of the Node.js
 * EventEmitter API that the runtime relies on (`emit` and `on`).
 */
export class WorkflowEventEmitter
  implements WorkflowEventEmitterLike<WorkflowEventEmitter>
{
  private listeners = new Map<EventKey, Set<AnyListener>>();

  emit<K extends keyof WorkflowEventMap>(
    event: K,
    payload: WorkflowEventMap[K],
  ): boolean {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners || eventListeners.size === 0) {
      return false;
    }

    eventListeners.forEach((listener) => listener(payload));

    return true;
  }

  on<K extends keyof WorkflowEventMap>(
    event: K,
    listener: (payload: WorkflowEventMap[K]) => void,
  ): this {
    const listeners = this.listeners.get(event) ?? new Set<AnyListener>();
    listeners.add(listener as AnyListener);
    this.listeners.set(event, listeners);

    return this;
  }
}
