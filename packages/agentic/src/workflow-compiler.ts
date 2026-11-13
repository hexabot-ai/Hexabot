/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z, ZodType } from 'zod';

import type { Action } from './action/action.types';
import type { BindingKindSchemas } from './bindings/base-binding';
import {
  mountTaskBindings,
  validateAndResolveBindings,
} from './bindings/base-binding';
import type {
  ConditionalBlock,
  FlowStep,
  LoopStep as LoopBlock,
  ParallelBlock,
  WorkflowDefinition,
  WorkflowInputSchema,
} from './dsl.types';
import { extractTaskDefinitions as extractTaskDefinitionsFromDefs } from './dsl.types';
import { issueMessages } from './validation-issue';
import { StepType } from './workflow-event-emitter';
import type {
  CompiledMapping,
  CompiledStep,
  CompiledTask,
  CompiledWorkflow,
  ConditionalStep,
  LoopStep,
  ParallelStep,
} from './workflow-types';
import {
  compileValue,
  mergeSettings,
  type CompileValueOptions,
} from './workflow-values';

export type WorkflowCompileOptions = CompileValueOptions & {
  actions: Record<string, Action>;
  bindingKinds?: BindingKindSchemas;
};

/** Build a stable identifier for a step using its path and label. */
const buildStepId = (path: Array<number | string>, label: string): string => {
  const pathPart = path.length > 0 ? path.join('.') : 'root';

  return `${pathPart}:${label}`;
};

/**
 * Build the parser of a workflow's input payload from its `inputs.schema`.
 *
 * This is the one conversion from that JSON Schema to a parser: the runner
 * uses it when a run starts, and a host that checks an input before creating
 * a run should use it too, so both accept and refuse the same payloads. The
 * parser applies the schema's `default` values.
 *
 * @param schema The JSON Schema under `inputs.schema`, when one is declared.
 * @returns A parser of the input payload; it accepts any object without a schema.
 * @throws When the schema is not a JSON Schema zod can read.
 */
export const buildWorkflowInputParser = (
  schema?: WorkflowInputSchema,
): ZodType<Record<string, unknown>> =>
  schema
    ? (z.fromJSONSchema(schema) as ZodType<Record<string, unknown>>)
    : z.looseObject({});
/** Compile a raw mapping object into expression-aware value mappings. */
const compileMapping = (
  values?: Record<string, unknown>,
  options?: WorkflowCompileOptions,
): CompiledMapping | undefined => {
  if (!values) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      compileValue(value, options),
    ]),
  );
};
/** Parse settings, compile inputs, and bind actions for each task. */
const compileTasks = (
  definition: WorkflowDefinition,
  options: WorkflowCompileOptions,
): Record<string, CompiledTask> => {
  const compiled: Record<string, CompiledTask> = {};
  const defaultSettings = definition.defaults?.settings;
  const taskDefinitions = extractTaskDefinitionsFromDefs(definition.defs);
  const bindingValidation = validateAndResolveBindings(definition, {
    bindingKinds: options.bindingKinds,
    actions: options.actions,
  });

  if (bindingValidation.issues.length > 0) {
    throw new Error(
      `Workflow bindings validation failed: ${issueMessages(bindingValidation.issues).join('; ')}`,
    );
  }

  for (const [taskName, task] of Object.entries(taskDefinitions)) {
    const action = options.actions[task.action];
    const settingsPayload = mergeSettings(defaultSettings, task.settings);
    const parsedSettings = action.parseSettings(settingsPayload);

    compiled[taskName] = {
      name: taskName,
      actionName: task.action,
      definition: task,
      action,
      inputs: compileMapping(task.inputs, options) ?? {},
      settings: parsedSettings,
      bindings: mountTaskBindings(
        task.bindings,
        bindingValidation.resolvedDefs,
        options.bindingKinds,
      ),
    };
  }

  return compiled;
};
/** Recursively compile flow steps into executable nodes with generated ids. */
const compileFlowSteps = (
  steps: FlowStep[],
  path: Array<number | string> = [],
  options?: WorkflowCompileOptions,
): CompiledStep[] =>
  steps.map((step, index) => compileFlowStep(step, [...path, index], options));
const compileFlowStep = (
  step: FlowStep,
  stepPath: Array<number | string>,
  options?: WorkflowCompileOptions,
): CompiledStep => {
  if ('do' in step) {
    return {
      type: StepType.Task,
      id: buildStepId(stepPath, step.do),
      label: step.do,
      taskName: step.do,
    };
  }

  if ('parallel' in step) {
    return compileParallelStep(step.parallel, stepPath, options);
  }

  if ('conditional' in step) {
    return compileConditionalStep(step.conditional, stepPath, options);
  }

  return compileLoopStep(step.loop, stepPath, options);
};
const compileParallelStep = (
  parallel: ParallelBlock,
  stepPath: Array<number | string>,
  options?: WorkflowCompileOptions,
): ParallelStep => ({
  type: StepType.Parallel,
  id: buildStepId(stepPath, 'parallel'),
  label: parallel.description ?? 'parallel',
  description: parallel.description,
  strategy: parallel.strategy ?? 'wait_all',
  steps: compileFlowSteps(parallel.steps, [...stepPath, 'parallel'], options),
});
const compileConditionalStep = (
  conditional: ConditionalBlock,
  stepPath: Array<number | string>,
  options?: WorkflowCompileOptions,
): ConditionalStep => ({
  type: StepType.Conditional,
  id: buildStepId(stepPath, 'conditional'),
  label: conditional.description ?? 'conditional',
  description: conditional.description,
  branches: conditional.when.map((branch, branchIndex) => {
    const branchPath = [...stepPath, 'branch', branchIndex];

    return {
      id: buildStepId(branchPath, 'conditional'),
      condition:
        'condition' in branch
          ? compileValue(branch.condition, options)
          : undefined,
      steps: compileFlowSteps(branch.steps, branchPath, options),
    };
  }),
});
const compileLoopStep = (
  loop: LoopBlock,
  stepPath: Array<number | string>,
  options?: WorkflowCompileOptions,
): LoopStep => {
  const label = loop.name ?? 'loop';
  const common = {
    type: StepType.Loop,
    id: buildStepId(stepPath, label),
    label,
    name: loop.name,
    description: loop.description,
    accumulate: loop.accumulate
      ? {
          as: loop.accumulate.as,
          initial: loop.accumulate.initial,
          merge: compileValue(loop.accumulate.merge, options),
        }
      : undefined,
    steps: compileFlowSteps(loop.steps, [...stepPath, label], options),
  } as const;

  if (loop.type === 'for_each') {
    return {
      ...common,
      loopType: 'for_each',
      forEach: {
        item: loop.for_each.item,
        in: compileValue(loop.for_each.in, options),
      },
      maxConcurrency: loop.max_concurrency,
      until: loop.until ? compileValue(loop.until, options) : undefined,
    };
  }

  return {
    ...common,
    loopType: 'while',
    while: compileValue(loop.while, options),
  };
};

/** Compile a workflow definition into structures consumable by the runtime. */
export const compileWorkflow = (
  definition: WorkflowDefinition,
  options: WorkflowCompileOptions,
): CompiledWorkflow => {
  const inputParser = buildWorkflowInputParser(definition.inputs?.schema);
  const tasks = compileTasks(definition, options);
  const flow = compileFlowSteps(definition.flow, [], options);
  const outputMapping = compileMapping(definition.outputs, options) ?? {};

  return {
    definition,
    tasks,
    flow,
    outputMapping,
    inputParser,
    defaultSettings: definition.defaults?.settings,
  };
};
