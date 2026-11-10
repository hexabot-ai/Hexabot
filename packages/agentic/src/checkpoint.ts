/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import {
  WorkflowCheckpointInvalidError,
  WorkflowDefinitionDriftError,
  WorkflowResumeError,
  WorkflowWaitAmbiguousError,
  WorkflowWaitNotFoundError,
} from './errors';
import { checkResumePayload, describeSchemaIssues } from './resume-payload';
import { isRecord } from './utils/clone';
import { StepType, type StepInfo } from './workflow-event-emitter';
import { fingerprintWorkflow } from './workflow-fingerprint';
import type {
  CompiledStep,
  CompiledWorkflow,
  ConditionalStep,
  LoopStep,
  ParallelStep,
} from './workflow-types';

/** Current format version of {@link WorkflowCheckpoint}. */
export const CHECKPOINT_VERSION = 1;

/** One open suspension a run is waiting on. */
export type WaitInfo = {
  /**
   * Handle a host passes to `resume()` to satisfy this wait. Opaque: unique
   * within a run and stable for as long as the wait is open, but never meant
   * to be parsed.
   */
  waitId: string;
  /** Instance step (loop iterations included) that suspended. */
  step: StepInfo;
  /** Normalized suspend point inside the step body (`index:<n>` or `key:<k>`). */
  suspendKey: string;
  reason?: string;
  data?: unknown;
  /**
   * JSON Schema of the payload the wait accepts, in its JSON form, when
   * `suspend()` was given an `accepts` schema. It is relaxed so that it never
   * refuses a JSON payload the action would accept; the action's schema still
   * has the final say.
   */
  accepts?: Record<string, unknown>;
  /**
   * Set when the `accepts` schema also accepts a resume without payload,
   * which JSON Schema cannot express: `accepts` describes a payload that is
   * given.
   */
  payloadOptional?: boolean;
};

/**
 * Answer recorded for one `suspend()` call. The value is wrapped so that a
 * resume without payload, whose value is `undefined`, is still recorded as
 * answered once JSON drops the value.
 */
export type RecordedResult = { value?: unknown };

/**
 * Suspended task: the only frame that runs code on resume. Its body re-runs
 * with `inputs`, and every `suspend()` call already answered in
 * `awaitResults` resolves immediately.
 */
export type TaskFrame = {
  kind: 'task';
  stepId: string;
  inputs: Record<string, unknown>;
  /** Answers of the body's earlier `suspend()` calls, by suspend key. */
  awaitResults: Record<string, RecordedResult>;
  wait: WaitInfo;
};

/** Conditional whose chosen branch suspended; conditions are not re-evaluated. */
export type ConditionalFrame = {
  kind: 'conditional';
  stepId: string;
  branchIndex: number;
  child: SequenceFrame;
};

/** Loop suspended inside iteration `index`. */
export type LoopFrame = {
  kind: 'loop';
  stepId: string;
  index: number;
  /** Items resolved when a `for_each` loop started; absent for `while`. */
  items?: unknown[];
  /** Accumulator value at the start of iteration `index`. */
  accumulator?: unknown;
  child: SequenceFrame;
};

/** Settled state of one parallel branch when the block suspended. */
export type ParallelBranchFrame =
  | { status: 'fulfilled'; outputDelta: Record<string, unknown> }
  | {
      status: 'suspended';
      outputDelta: Record<string, unknown>;
      child: StepFrame;
    };

/** Parallel block with at least one suspended branch. */
export type ParallelFrame = {
  kind: 'parallel';
  stepId: string;
  branches: ParallelBranchFrame[];
};

/** Frame of a single compiled step. `stepId` is the compiled (not instance) id. */
export type StepFrame =
  | TaskFrame
  | ConditionalFrame
  | LoopFrame
  | ParallelFrame;

/** Position inside a list of sequential steps. */
export type SequenceFrame = {
  kind: 'sequence';
  index: number;
  /**
   * `$accumulator` of the sequence's scope when it suspended. A loop that
   * finished earlier in the sequence may have replaced the one the scope
   * started with.
   */
  accumulator?: unknown;
  child: StepFrame;
};

/**
 * Everything needed to resume a suspended run, in any process.
 *
 * The frame tree mirrors the compiled flow: each composite step records only
 * the local state it needs to continue (sequence position, chosen branch,
 * loop position, parallel branch outcomes), so resuming never replays work
 * that already completed.
 */
export type WorkflowCheckpoint = {
  version: typeof CHECKPOINT_VERSION;
  /** Definition fingerprint the frames were taken against. */
  fingerprint: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  root: SequenceFrame;
  /** Every open wait in the frame tree, in flow order. */
  waits: WaitInfo[];
};

export type CheckpointValidationResult =
  | { ok: true; checkpoint: WorkflowCheckpoint }
  | { ok: false; error: WorkflowResumeError };

const recordSchema = z.record(z.string(), z.unknown());
const stepIdSchema = z.string().min(1);
const stepInfoSchema = z.object({
  id: stepIdSchema,
  name: z.string(),
  type: z.enum(StepType),
});
const waitInfoSchema: z.ZodType<WaitInfo> = z.object({
  waitId: z.string().min(1),
  step: stepInfoSchema,
  suspendKey: z.string().min(1),
  reason: z.string().optional(),
  data: z.unknown().optional(),
  accepts: recordSchema.optional(),
  payloadOptional: z.boolean().optional(),
});
const taskFrameSchema: z.ZodType<TaskFrame> = z.object({
  kind: z.literal('task'),
  stepId: stepIdSchema,
  inputs: recordSchema,
  awaitResults: z.record(
    z.string(),
    z.object({ value: z.unknown().optional() }),
  ),
  wait: waitInfoSchema,
});
const conditionalFrameSchema: z.ZodType<ConditionalFrame> = z.lazy(() =>
  z.object({
    kind: z.literal('conditional'),
    stepId: stepIdSchema,
    branchIndex: z.int().nonnegative(),
    child: sequenceFrameSchema,
  }),
);
const loopFrameSchema: z.ZodType<LoopFrame> = z.lazy(() =>
  z.object({
    kind: z.literal('loop'),
    stepId: stepIdSchema,
    index: z.int().nonnegative(),
    items: z.array(z.unknown()).optional(),
    accumulator: z.unknown().optional(),
    child: sequenceFrameSchema,
  }),
);
const parallelFrameSchema: z.ZodType<ParallelFrame> = z.lazy(() =>
  z.object({
    kind: z.literal('parallel'),
    stepId: stepIdSchema,
    branches: z.array(
      z.union([
        z.object({ status: z.literal('fulfilled'), outputDelta: recordSchema }),
        z.object({
          status: z.literal('suspended'),
          outputDelta: recordSchema,
          child: stepFrameSchema,
        }),
      ]),
    ),
  }),
);
const stepFrameSchema: z.ZodType<StepFrame> = z.lazy(() =>
  z.union([
    taskFrameSchema,
    conditionalFrameSchema,
    loopFrameSchema,
    parallelFrameSchema,
  ]),
);
const sequenceFrameSchema: z.ZodType<SequenceFrame> = z.lazy(() =>
  z.object({
    kind: z.literal('sequence'),
    index: z.int().nonnegative(),
    accumulator: z.unknown().optional(),
    child: stepFrameSchema,
  }),
);

/** Schema of a persisted {@link WorkflowCheckpoint}, for hosts to type storage. */
export const workflowCheckpointSchema: z.ZodType<WorkflowCheckpoint> = z.object(
  {
    version: z.literal(CHECKPOINT_VERSION),
    fingerprint: z.string().min(1),
    input: recordSchema,
    output: recordSchema,
    root: sequenceFrameSchema,
    waits: z.array(waitInfoSchema).min(1),
  },
);

/**
 * Build the handle of a wait from the instance step that suspended and its
 * suspend key.
 *
 * @param stepInstanceId Instance step id, including any loop iteration suffix.
 * @param suspendKey Normalized suspend key within the step body.
 * @returns The wait id.
 */
export const buildWaitId = (
  stepInstanceId: string,
  suspendKey: string,
): string => `${stepInstanceId}@${suspendKey}`;

/**
 * List the open waits held by a frame tree, in flow order.
 *
 * @param frame Root or subtree of a checkpoint.
 * @returns The waits of every suspended task under the frame.
 */
export function collectWaits(frame: SequenceFrame | StepFrame): WaitInfo[] {
  switch (frame.kind) {
    case 'task':
      return [frame.wait];
    case 'sequence':
    case 'conditional':
    case 'loop':
      return collectWaits(frame.child);
    case 'parallel':
      return frame.branches.flatMap((branch) =>
        branch.status === 'suspended' ? collectWaits(branch.child) : [],
      );
  }
}

/**
 * Pick the wait a resume targets. `resume()` and `validateCheckpoint` both
 * use it, so a payload is always checked against the wait it would resolve.
 *
 * @param waits Open waits of the suspended run.
 * @param waitId Requested wait, optional when exactly one wait is open.
 * @returns The targeted wait.
 * @throws {WorkflowWaitNotFoundError} When `waitId` is not an open wait.
 * @throws {WorkflowWaitAmbiguousError} When several waits are open and no
 * `waitId` is given.
 */
export function selectWait(waits: WaitInfo[], waitId?: string): WaitInfo {
  const openWaitIds = waits.map((candidate) => candidate.waitId);
  if (waitId === undefined) {
    if (waits.length === 1) {
      return waits[0];
    }

    throw new WorkflowWaitAmbiguousError(openWaitIds);
  }

  const wait = waits.find((candidate) => candidate.waitId === waitId);
  if (!wait) {
    throw new WorkflowWaitNotFoundError(waitId, openWaitIds);
  }

  return wait;
}

/**
 * Check that a frame was taken for the given compiled step.
 *
 * @param frame The frame about to be resumed, if any.
 * @param step The compiled step it is being handed to.
 * @param path Location used in the error message.
 * @throws {WorkflowCheckpointInvalidError} When the frame belongs elsewhere.
 */
export function assertFrameMatchesStep(
  frame: StepFrame | undefined,
  step: CompiledStep,
  path: Array<string | number> = [],
): void {
  if (!frame) {
    return;
  }

  if ((frame.kind as string) !== step.type || frame.stepId !== step.id) {
    throw new WorkflowCheckpointInvalidError(
      'structure',
      `Checkpoint expects ${frame.kind} step "${frame.stepId}" but the flow ` +
        `has ${step.type} step "${step.id}".`,
      { path },
    );
  }
}

/**
 * Decide whether a checkpoint can resume against a compiled workflow, without
 * running anything.
 *
 * Checks, in order: presence and shape, format version, definition
 * fingerprint, that every frame lines up with the compiled step it names, that
 * the `waits` index matches the frame tree, and (optionally) that a given wait
 * is open and accepts a given payload.
 *
 * @param compiled The compiled workflow the run will resume against.
 * @param checkpoint The persisted checkpoint, as stored.
 * @param options.waitId Wait the caller is about to resume.
 * @param options.resumeData Payload the caller is about to resume with. When
 * the key is present, it is checked against the wait `resume()` would pick:
 * the one named by `waitId`, or the only open wait.
 * @returns The parsed checkpoint, or the typed reason it cannot resume.
 */
export function validateCheckpoint(
  compiled: CompiledWorkflow,
  checkpoint: unknown,
  options: { waitId?: string; resumeData?: unknown } = {},
): CheckpointValidationResult {
  try {
    const parsed = parseCheckpoint(checkpoint);
    const actual = fingerprintWorkflow(compiled);
    if (parsed.fingerprint !== actual) {
      throw new WorkflowDefinitionDriftError(parsed.fingerprint, actual);
    }

    assertSequenceMatches(compiled.flow, parsed.root, ['root']);
    assertWaitIndex(parsed);

    if (options.waitId !== undefined || 'resumeData' in options) {
      const wait = selectWait(parsed.waits, options.waitId);
      if ('resumeData' in options) {
        const payload = checkResumePayload(wait, options.resumeData);
        if (!payload.ok) {
          throw payload.error;
        }
      }
    }

    return { ok: true, checkpoint: parsed };
  } catch (error) {
    if (error instanceof WorkflowResumeError) {
      return { ok: false, error };
    }

    throw error;
  }
}

const parseCheckpoint = (checkpoint: unknown): WorkflowCheckpoint => {
  if (checkpoint === null || checkpoint === undefined) {
    throw new WorkflowCheckpointInvalidError(
      'missing',
      'No checkpoint was persisted for this run.',
    );
  }

  if (
    isRecord(checkpoint) &&
    checkpoint.version !== undefined &&
    checkpoint.version !== CHECKPOINT_VERSION
  ) {
    throw new WorkflowCheckpointInvalidError(
      'unsupported_version',
      `Unsupported checkpoint version ${String(checkpoint.version)}; ` +
        `expected ${CHECKPOINT_VERSION}.`,
    );
  }

  const result = workflowCheckpointSchema.safeParse(checkpoint);
  if (!result.success) {
    const issues = describeSchemaIssues(result.error.issues);

    throw new WorkflowCheckpointInvalidError(
      'malformed',
      `Checkpoint does not match the expected shape: ${issues.join('; ')}`,
      { issues },
    );
  }

  return result.data;
};
const structureError = (message: string, path: Array<string | number>) =>
  new WorkflowCheckpointInvalidError('structure', message, { path });
const assertSequenceMatches = (
  steps: CompiledStep[],
  frame: SequenceFrame,
  path: Array<string | number>,
): void => {
  const step = steps[frame.index];
  if (!step) {
    throw structureError(
      `Sequence position ${frame.index} is out of range (${steps.length} steps).`,
      path,
    );
  }

  assertStepMatches(step, frame.child, [...path, frame.index]);
};
const assertStepMatches = (
  step: CompiledStep,
  frame: StepFrame,
  path: Array<string | number>,
): void => {
  assertFrameMatchesStep(frame, step, path);

  switch (step.type) {
    case StepType.Task:
      return;
    case StepType.Conditional:
      return assertConditionalMatches(step, frame as ConditionalFrame, path);
    case StepType.Loop:
      return assertLoopMatches(step, frame as LoopFrame, path);
    case StepType.Parallel:
      return assertParallelMatches(step, frame as ParallelFrame, path);
  }
};
const assertConditionalMatches = (
  step: ConditionalStep,
  frame: ConditionalFrame,
  path: Array<string | number>,
): void => {
  const branch = step.branches[frame.branchIndex];
  if (!branch) {
    throw structureError(
      `Branch ${frame.branchIndex} does not exist on conditional "${step.id}".`,
      path,
    );
  }

  assertSequenceMatches(branch.steps, frame.child, [
    ...path,
    'branch',
    frame.branchIndex,
  ]);
};
const assertLoopMatches = (
  step: LoopStep,
  frame: LoopFrame,
  path: Array<string | number>,
): void => {
  if (step.loopType === 'for_each') {
    if (!frame.items || frame.index >= frame.items.length) {
      throw structureError(
        `for_each loop "${step.id}" is suspended at iteration ${frame.index} ` +
          `of ${frame.items?.length ?? 0} recorded items.`,
        path,
      );
    }
  } else if (frame.items !== undefined) {
    throw structureError(
      `while loop "${step.id}" cannot carry for_each items.`,
      path,
    );
  }

  assertSequenceMatches(step.steps, frame.child, [...path, frame.index]);
};
const assertParallelMatches = (
  step: ParallelStep,
  frame: ParallelFrame,
  path: Array<string | number>,
): void => {
  if (frame.branches.length !== step.steps.length) {
    throw structureError(
      `Parallel "${step.id}" has ${step.steps.length} branches but the ` +
        `checkpoint records ${frame.branches.length}.`,
      path,
    );
  }

  let suspended = 0;
  frame.branches.forEach((branch, index) => {
    if (branch.status === 'suspended') {
      suspended += 1;
      assertStepMatches(step.steps[index], branch.child, [
        ...path,
        'parallel',
        index,
      ]);
    } else if (step.strategy === 'wait_any') {
      // A fulfilled branch wins a wait_any race, so it can never be parked.
      throw structureError(
        `wait_any parallel "${step.id}" cannot record a fulfilled branch.`,
        path,
      );
    }
  });

  if (suspended === 0) {
    throw structureError(
      `Parallel "${step.id}" is recorded as suspended without a suspended branch.`,
      path,
    );
  }
};
const assertWaitIndex = (checkpoint: WorkflowCheckpoint): void => {
  const expected = collectWaits(checkpoint.root).map((wait) => wait.waitId);
  const actual = checkpoint.waits.map((wait) => wait.waitId);

  if (
    expected.length !== actual.length ||
    expected.some((waitId, index) => waitId !== actual[index])
  ) {
    throw structureError(
      `Checkpoint waits [${actual.join(', ')}] do not match the suspended ` +
        `steps [${expected.join(', ')}].`,
      ['waits'],
    );
  }

  if (new Set(expected).size !== expected.length) {
    throw structureError(
      `Checkpoint holds duplicate waits [${expected.join(', ')}].`,
      ['waits'],
    );
  }
};
