/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

export class WorkflowCancellationError extends Error {
  constructor(message = 'Workflow execution was cancelled.') {
    super(message);
    this.name = 'WorkflowCancellationError';
  }
}

/** Base class for every reason a suspended run cannot be resumed. */
export abstract class WorkflowResumeError extends Error {}

export type WorkflowCheckpointInvalidCode =
  | 'missing'
  | 'malformed'
  | 'unsupported_version'
  | 'structure';

/**
 * The checkpoint cannot be used: nothing was persisted, its shape is wrong,
 * its format version is unsupported, or its frames do not line up with the
 * compiled flow they claim to describe.
 */
export class WorkflowCheckpointInvalidError extends WorkflowResumeError {
  public readonly code: WorkflowCheckpointInvalidCode;

  /** Location inside the checkpoint where validation failed, when known. */
  public readonly path?: Array<string | number>;

  /** Individual schema issues, for `malformed` checkpoints. */
  public readonly issues?: string[];

  constructor(
    code: WorkflowCheckpointInvalidCode,
    message: string,
    options?: { path?: Array<string | number>; issues?: string[] },
  ) {
    super(message);
    this.name = 'WorkflowCheckpointInvalidError';
    this.code = code;
    this.path = options?.path;
    this.issues = options?.issues;
  }
}

/**
 * The compiled definition no longer matches the one the checkpoint was taken
 * against, so its frames cannot be trusted to point at the same steps.
 */
export class WorkflowDefinitionDriftError extends WorkflowResumeError {
  public readonly expected: string;

  public readonly actual: string;

  constructor(expected: string, actual: string) {
    super(
      'Workflow definition changed since this run was suspended ' +
        `(checkpoint fingerprint ${expected}, current ${actual}).`,
    );
    this.name = 'WorkflowDefinitionDriftError';
    this.expected = expected;
    this.actual = actual;
  }
}

/** Several waits are open and the resume did not say which one it satisfies. */
export class WorkflowWaitAmbiguousError extends WorkflowResumeError {
  public readonly openWaitIds: string[];

  constructor(openWaitIds: string[]) {
    super(
      `Workflow run is waiting on ${openWaitIds.length} suspensions; pass a ` +
        `waitId to choose one (${openWaitIds.join(', ')}).`,
    );
    this.name = 'WorkflowWaitAmbiguousError';
    this.openWaitIds = openWaitIds;
  }
}

/** The run is not waiting on the requested suspension. */
export class WorkflowWaitNotFoundError extends WorkflowResumeError {
  public readonly waitId: string;

  public readonly openWaitIds: string[];

  constructor(waitId: string, openWaitIds: string[]) {
    super(
      `Workflow run is not waiting on "${waitId}"` +
        (openWaitIds.length > 0
          ? ` (open waits: ${openWaitIds.join(', ')}).`
          : ' (no open waits).'),
    );
    this.name = 'WorkflowWaitNotFoundError';
    this.waitId = waitId;
    this.openWaitIds = openWaitIds;
  }
}

/**
 * The resume payload was refused. The wait stays open under the same
 * `waitId`, so it can be resumed again, and the run's checkpoint, snapshot
 * and step log are left as they were. Events already emitted by
 * a body that refused the payload stay emitted, and its side effects,
 * including writes to context state, are not undone.
 *
 * The runtime raises it when a payload does not match the `accepts` schema of
 * the wait. An action may throw it itself, after its `suspend()` call
 * resolved, to refuse a payload for reasons a schema cannot express.
 */
export class WorkflowResumeRejectedError extends WorkflowResumeError {
  /** Individual schema issues, when a schema refused the payload. */
  public readonly issues?: string[];

  constructor(message: string, options?: { issues?: string[] }) {
    super(message);
    this.name = 'WorkflowResumeRejectedError';
    this.issues = options?.issues;
  }
}

/**
 * A resumed action body did not replay the way it ran before it suspended,
 * so the results recorded for it cannot be trusted.
 */
export class NonDeterministicWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonDeterministicWorkflowError';
  }
}

// Errors that cross into action code are also matched by name: an extension
// may import the other (CJS or ESM) build of this package, whose classes are
// distinct from these.
const isNamedError = (error: unknown, name: string): boolean =>
  error instanceof Error && error.name === name;

export const isWorkflowResumeRejectedError = (
  error: unknown,
): error is WorkflowResumeRejectedError =>
  error instanceof WorkflowResumeRejectedError ||
  isNamedError(error, 'WorkflowResumeRejectedError');

export const isNonDeterministicWorkflowError = (
  error: unknown,
): error is NonDeterministicWorkflowError =>
  error instanceof NonDeterministicWorkflowError ||
  isNamedError(error, 'NonDeterministicWorkflowError');

export const getAbortReason = (signal: AbortSignal): Error => {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }

  if (signal.reason !== undefined) {
    return new WorkflowCancellationError(String(signal.reason));
  }

  return new WorkflowCancellationError();
};

export const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw getAbortReason(signal);
  }
};

/**
 * Create a controller that aborts along with a parent signal, so a child
 * scope can be cancelled on its own without cancelling the parent.
 *
 * @param parent Signal whose abort propagates to the new controller.
 * @returns The controller, and a function detaching it from `parent`.
 */
export const createLinkedAbortController = (
  parent: AbortSignal,
): { controller: AbortController; unlink: () => void } => {
  const controller = new AbortController();
  if (parent.aborted) {
    controller.abort(getAbortReason(parent));

    return { controller, unlink: () => undefined };
  }

  const onAbort = () => controller.abort(getAbortReason(parent));
  parent.addEventListener('abort', onAbort, { once: true });

  return {
    controller,
    unlink: () => parent.removeEventListener('abort', onAbort),
  };
};
