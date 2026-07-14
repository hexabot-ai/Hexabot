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
import type { BaseWorkflowContext } from './context';
import type {
  FlowStep,
  InputField,
  TaskDefinition,
  WorkflowDefinition,
} from './dsl.types';
import { extractTaskDefinitions as extractTaskDefinitionsFromDefs } from './dsl.types';
import { issueMessages } from './validation-issue';
import { StepType } from './workflow-event-emitter';
import type {
  CompiledMapping,
  CompiledStep,
  CompiledTask,
  CompiledWorkflow,
  ConditionalBranch,
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
/** Convert workflow input field metadata to a zod schema. */
const inputFieldToZod = (field: InputField): ZodType => {
  let schema: ZodType;

  switch (field.type) {
    case 'string':
      schema = z.string();
      break;
    case 'number':
      schema = z.number();
      break;
    case 'integer':
      schema = z.int();
      break;
    case 'boolean':
      schema = z.boolean();
      break;
    case 'array':
      schema = z.array(field.items ? inputFieldToZod(field.items) : z.any());
      break;
    case 'object': {
      const properties: Record<string, ZodType> = {};
      if (field.properties) {
        for (const [name, child] of Object.entries(field.properties)) {
          properties[name] = inputFieldToZod(child).optional();
        }
      }
      schema =
        Object.keys(properties).length > 0
          ? z.strictObject(properties).partial()
          : z.record(z.string(), z.any());
      break;
    }
    default:
      schema = z.any();
  }

  if (field.enum) {
    schema = schema.refine(
      (value) => field.enum?.some((allowed) => allowed === value),
      {
        message: `Value must be one of: ${field.enum.join(', ')}`,
      },
    );
  }

  return schema;
};
/** Assemble a parser for the workflow top-level input payload. */
const buildInputParser = (
  schema?: Record<string, InputField>,
): ZodType<Record<string, unknown>> => {
  if (!schema || Object.keys(schema).length === 0) {
    return z.looseObject({});
  }

  const shape: Record<string, ZodType> = {};

  for (const [name, field] of Object.entries(schema)) {
    shape[name] = inputFieldToZod(field).optional();
  }

  return z.strictObject(shape).partial();
};
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
/** Ensure every task references a provided action implementation. */
const assertActionsBound = (
  tasks: Record<string, TaskDefinition>,
  actions: Record<string, Action<unknown, unknown, BaseWorkflowContext>>,
) => {
  const missing = Object.values(tasks)
    .map((task) => task.action)
    .filter(
      (actionName) =>
        !Object.prototype.hasOwnProperty.call(actions, actionName),
    );

  if (missing.length > 0) {
    throw new Error(
      `No action implementations provided for: ${missing.join(', ')}`,
    );
  }
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

  assertActionsBound(taskDefinitions, options.actions);

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
  steps.map<CompiledStep>((step, index) => {
    const stepPath = [...path, index];

    if ('do' in step) {
      const label = step.do;

      return {
        type: StepType.Task,
        id: buildStepId(stepPath, step.do),
        label,
        taskName: step.do,
      };
    }

    if ('parallel' in step) {
      const label = step.parallel.description ?? 'parallel';

      return {
        type: StepType.Parallel,
        id: buildStepId(stepPath, 'parallel'),
        label,
        description: step.parallel.description,
        strategy: step.parallel.strategy ?? 'wait_all',
        steps: compileFlowSteps(
          step.parallel.steps,
          [...stepPath, 'parallel'],
          options,
        ),
      } as ParallelStep;
    }

    if ('conditional' in step) {
      const label = step.conditional.description ?? 'conditional';
      const branches: ConditionalBranch[] = step.conditional.when.map(
        (branch, branchIdx) => ({
          id: buildStepId([...stepPath, 'branch', branchIdx], 'conditional'),
          condition:
            'condition' in branch
              ? compileValue(branch.condition, options)
              : undefined,
          steps: compileFlowSteps(
            branch.steps,
            [...stepPath, 'branch', branchIdx],
            options,
          ),
        }),
      );

      return {
        type: StepType.Conditional,
        id: buildStepId(stepPath, 'conditional'),
        label,
        description: step.conditional.description,
        branches,
      };
    }

    const loop = step.loop;
    const label = loop.name ?? 'loop';
    const commonLoop = {
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
      steps: compileFlowSteps(
        loop.steps,
        [...stepPath, loop.name ?? 'loop'],
        options,
      ),
    } as const;

    if (loop.type === 'for_each') {
      return {
        ...commonLoop,
        loopType: 'for_each',
        forEach: {
          item: loop.for_each.item,
          in: compileValue(loop.for_each.in, options),
        },
        maxConcurrency: loop.max_concurrency,
        until: loop.until ? compileValue(loop.until, options) : undefined,
      } as LoopStep;
    }

    return {
      ...commonLoop,
      loopType: 'while',
      while: compileValue(loop.while, options),
    } as LoopStep;
  });

/** Compile a workflow definition into structures consumable by the runtime. */
export const compileWorkflow = (
  definition: WorkflowDefinition,
  options: WorkflowCompileOptions,
): CompiledWorkflow => {
  const inputParser = buildInputParser(definition.inputs?.schema);
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
