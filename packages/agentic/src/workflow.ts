/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { stringify as stringifyYaml } from 'yaml';

import {
  validateCheckpoint,
  type CheckpointValidationResult,
  type WaitInfo,
} from './checkpoint';
import {
  EWorkflowRunStatus,
  type BaseWorkflowContext,
  type WorkflowSnapshot,
} from './context';
import {
  TASK_KIND,
  WorkflowDefinition,
  WorkflowDefinitionSchema,
  validateWorkflow,
  type FlowStep,
} from './dsl.types';
import { safeRenameTaskInDefinition as renameTaskInDefinition } from './utils/workflow-definition';
import { issueMessages } from './validation-issue';
import {
  compileWorkflow,
  type WorkflowCompileOptions,
} from './workflow-compiler';
import { WorkflowRunner } from './workflow-runner';
import type { CompiledWorkflow, WorkflowRunOptions } from './workflow-types';

export { compileWorkflow } from './workflow-compiler';

export { WorkflowEventEmitter } from './workflow-event-emitter';

export { WorkflowRunner } from './workflow-runner';

export type { WorkflowRunOptions, WorkflowRunResult } from './workflow-types';

export type { WorkflowCompileOptions } from './workflow-compiler';

export type FlowStepPath = Array<string | number>;

class WorkflowRunSuspendedError extends Error {
  /** Every open wait of the run, in flow order. */
  public readonly waits: WaitInfo[];

  constructor(waits: WaitInfo[]) {
    const steps = waits.map(({ step, reason }) =>
      reason ? `${step.id} (${reason})` : step.id,
    );

    super(`Workflow run suspended at ${steps.join(', ')}`);
    this.name = 'WorkflowRunSuspendedError';
    this.waits = waits;
  }
}

const getTaskNameFromStep = (step: unknown): string | null => {
  if (!step || typeof step !== 'object') {
    return null;
  }

  const taskName = (step as { do?: unknown }).do;

  return typeof taskName === 'string' ? taskName : null;
};
const hasTaskReference = (steps: FlowStep[], taskName: string): boolean => {
  return steps.some((step) => {
    if ('do' in step) {
      return step.do === taskName;
    }

    if ('parallel' in step) {
      return hasTaskReference(step.parallel.steps, taskName);
    }

    if ('conditional' in step) {
      return step.conditional.when.some((branch) =>
        hasTaskReference(branch.steps, taskName),
      );
    }

    if ('loop' in step) {
      return hasTaskReference(step.loop.steps, taskName);
    }

    return false;
  });
};

/**
 * Entry point for preparing and executing workflows from YAML or object definitions.
 * Instances are thin wrappers around a compiled workflow graph.
 */
export class Workflow {
  private readonly compiled: CompiledWorkflow;

  private constructor(compiled: CompiledWorkflow) {
    this.compiled = compiled;
  }

  /**
   * Create a workflow from an already parsed definition.
   * The definition is validated before compilation to catch schema issues early.
   */
  static fromDefinition(
    definition: WorkflowDefinition,
    options: WorkflowCompileOptions,
  ): Workflow {
    const validation = validateWorkflow(definition, {
      bindingKinds: options.bindingKinds,
      actions: options.actions,
    });
    if (!validation.success) {
      throw new Error(
        `Workflow validation failed: ${issueMessages(validation.issues).join('; ')}`,
      );
    }

    const compiled = compileWorkflow(validation.data, options);

    return new Workflow(compiled);
  }

  /**
   * Create a workflow from YAML source.
   * YAML is validated and compiled before being wrapped in a {@link Workflow} instance.
   */
  static fromYaml(yaml: string, options: WorkflowCompileOptions): Workflow {
    const validation = validateWorkflow(yaml, {
      bindingKinds: options.bindingKinds,
      actions: options.actions,
    });
    if (!validation.success) {
      throw new Error(
        `Workflow validation failed: ${issueMessages(validation.issues).join('; ')}`,
      );
    }

    const compiled = compileWorkflow(validation.data, options);

    return new Workflow(compiled);
  }

  /**
   * Convert a workflow definition to YAML.
   * The definition is validated before serialization.
   */
  static stringifyDefinition(definition: WorkflowDefinition): string {
    const parsed = WorkflowDefinitionSchema.parse(definition);

    return stringifyYaml(parsed);
  }

  /**
   * Resolve a nested value from a workflow definition by path.
   */
  static getValueAtPath(value: unknown, path: FlowStepPath): unknown {
    return path.reduce<unknown>((acc, key) => {
      if (acc === null || acc === undefined) {
        return undefined;
      }
      if (Array.isArray(acc)) {
        return typeof key === 'number' ? acc[key] : undefined;
      }
      if (typeof acc === 'object') {
        return (acc as Record<string, unknown>)[String(key)];
      }

      return undefined;
    }, value);
  }

  /**
   * Create a new value with a nested path updated immutably.
   */
  static setValueAtPath<T>(
    value: T,
    path: FlowStepPath,
    nextValue: unknown,
  ): T {
    if (path.length === 0) {
      return nextValue as T;
    }

    const [key, ...rest] = path;

    if (Array.isArray(value)) {
      if (typeof key !== 'number') {
        return value;
      }
      const nextArray = [...value];

      nextArray[key] = Workflow.setValueAtPath(value[key], rest, nextValue);

      return nextArray as unknown as T;
    }

    if (value && typeof value === 'object') {
      return {
        ...(value as Record<string, unknown>),
        [String(key)]: Workflow.setValueAtPath(
          (value as Record<string, unknown>)[String(key)],
          rest,
          nextValue,
        ),
      } as T;
    }

    return value;
  }

  /**
   * Remove a flow step from the definition at the given path, if valid.
   */
  static removeStepAtPath(
    definition: WorkflowDefinition,
    stepPath: FlowStepPath,
  ): WorkflowDefinition | null {
    if (!stepPath.length) {
      return null;
    }

    const removeIndex = stepPath[stepPath.length - 1];

    if (typeof removeIndex !== 'number') {
      return null;
    }

    const stepsPath = stepPath.slice(0, -1);
    const steps = Workflow.getValueAtPath(definition, stepsPath);

    if (!Array.isArray(steps)) {
      return null;
    }

    if (removeIndex < 0 || removeIndex >= steps.length) {
      return null;
    }

    const removedTaskName = getTaskNameFromStep(steps[removeIndex]);
    const nextSteps = [...steps];

    nextSteps.splice(removeIndex, 1);

    const nextDefinition = Workflow.setValueAtPath(
      definition,
      stepsPath,
      nextSteps,
    );

    if (
      !removedTaskName ||
      !Object.prototype.hasOwnProperty.call(
        nextDefinition.defs,
        removedTaskName,
      )
    ) {
      return nextDefinition;
    }

    if (nextDefinition.defs[removedTaskName]?.kind !== TASK_KIND) {
      return nextDefinition;
    }

    if (hasTaskReference(nextDefinition.flow, removedTaskName)) {
      return nextDefinition;
    }

    const { [removedTaskName]: _removedTask, ...remainingDefs } =
      nextDefinition.defs;

    return {
      ...nextDefinition,
      defs: remainingDefs,
    };
  }

  /**
   * Insert a flow step into the definition at the given path, if valid.
   */
  static insertStepAtPath(
    definition: WorkflowDefinition,
    insertPath: FlowStepPath,
    step: FlowStep,
  ): WorkflowDefinition | null {
    if (!insertPath.length) {
      return null;
    }

    const insertIndex = insertPath[insertPath.length - 1];

    if (typeof insertIndex !== 'number') {
      return null;
    }

    const stepsPath = insertPath.slice(0, -1);
    const steps = Workflow.getValueAtPath(definition, stepsPath);

    if (!Array.isArray(steps)) {
      return null;
    }

    const nextSteps = [...steps];
    const safeIndex = Math.min(Math.max(insertIndex, 0), nextSteps.length);

    nextSteps.splice(safeIndex, 0, step);

    return Workflow.setValueAtPath(definition, stepsPath, nextSteps);
  }

  /**
   * Rename a task key and update references in flow steps and output expressions.
   */
  static safeRenameTaskInDefinition(
    definition: WorkflowDefinition,
    currentTaskName: string,
    nextTaskName: string,
  ): WorkflowDefinition {
    return renameTaskInDefinition(definition, currentTaskName, nextTaskName);
  }

  /**
   * Run the workflow until completion or suspension.
   * Throws when a task suspends so callers can capture the state.
   */
  async run(
    inputData: unknown,
    context: BaseWorkflowContext,
    options?: WorkflowRunOptions,
  ): Promise<Record<string, unknown>> {
    const runner = new WorkflowRunner(this.compiled, options);
    const result = await runner.start({
      inputData,
      context,
    });

    if (result.status === EWorkflowRunStatus.FINISHED) {
      return result.output;
    }

    if (result.status === EWorkflowRunStatus.FAILED) {
      throw result.error instanceof Error
        ? result.error
        : new Error(String(result.error));
    }

    context.attachWorkflowRuntime(undefined);
    throw new WorkflowRunSuspendedError(result.waits);
  }

  /**
   * Construct a runner without executing, allowing hosts to manage start/resume manually.
   */
  async buildAsyncRunner(
    options?: WorkflowRunOptions,
  ): Promise<WorkflowRunner> {
    return new WorkflowRunner(this.compiled, options);
  }

  /**
   * Decide whether a persisted checkpoint can resume against this workflow,
   * without running anything. Call it before claiming a wait.
   *
   * @param checkpoint The checkpoint, as persisted.
   * @param options.waitId Wait the caller is about to resume.
   * @param options.resumeData Payload the caller is about to resume with,
   * checked against what the wait accepts when the key is present.
   * @returns The parsed checkpoint, or the typed reason it cannot resume.
   */
  validateCheckpoint(
    checkpoint: unknown,
    options?: { waitId?: string; resumeData?: unknown },
  ): CheckpointValidationResult {
    return validateCheckpoint(this.compiled, checkpoint, options);
  }

  /**
   * Restore a suspended runner from its persisted checkpoint, useful after restarts.
   *
   * @throws {WorkflowResumeError} When the checkpoint cannot resume against this workflow.
   */
  buildRunnerFromCheckpoint(options: {
    checkpoint: unknown;
    context: BaseWorkflowContext;
    snapshot?: WorkflowSnapshot;
    runId?: string;
  }): WorkflowRunner {
    return WorkflowRunner.fromCheckpoint(this.compiled, options);
  }
}
