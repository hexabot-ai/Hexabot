/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import jsonata from 'jsonata';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import type { BindingKindSchemas } from './bindings/base-binding';
import { validateAndResolveBindings } from './bindings/base-binding';
import { SNAKE_CASE_REGEX } from './utils/naming';
import { type WorkflowValidationIssue } from './validation-issue';
import { mergeSettings } from './workflow-values';

export const ExpressionStringSchema = z
  .string()
  .regex(/^=/, 'Expression strings must start with "="')
  .superRefine((value, ctx) => {
    try {
      jsonata(value.slice(1));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown JSONata parse error';
      ctx.addIssue({
        code: 'custom',
        message: `Invalid JSONata expression: ${message}`,
      });
    }
  });

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// Per-action timeout in milliseconds; 0 disables the timeout wrapper.
export const DEFAULT_TIMEOUT_MS = 0;

export const DEFAULT_STEP_BUDGET = 10;

export const MAX_STEP_BUDGET = 100;

// Retry defaults: disabled with 3 attempts and exponential backoff starting at 25ms, capped at 10s, no jitter.
export const DEFAULT_RETRY_SETTINGS = {
  enabled: false,
  max_attempts: 3,
  backoff_ms: 25,
  max_delay_ms: 10_000,
  jitter: 0,
  multiplier: 1,
} as const;

export type InputField = {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: Array<string | number | boolean>;
  items?: InputField;
  properties?: Record<string, InputField>;
};

export type ConditionalBranch =
  | { condition: string; steps: FlowStep[] }
  | { else?: unknown; steps: FlowStep[] };

export type ConditionalBlock = {
  description?: string;
  when: ConditionalBranch[];
};

export type ParallelBlock = {
  description?: string;
  strategy?: 'wait_all' | 'wait_any';
  steps: FlowStep[];
};

export type LoopAccumulate = {
  as: string;
  initial: JsonValue;
  merge: string;
};

type BaseLoopStep = {
  name?: string;
  description?: string;
  accumulate?: LoopAccumulate;
  steps: FlowStep[];
};

export type ForEachLoopStep = BaseLoopStep & {
  type: 'for_each';
  for_each: { item: string; in: string };
  max_concurrency?: number;
  until?: string;
};

export type WhileLoopStep = BaseLoopStep & {
  type: 'while';
  while: string;
};

export type LoopStep = ForEachLoopStep | WhileLoopStep;

export type FlowStep =
  | { do: string }
  | { parallel: ParallelBlock }
  | { conditional: ConditionalBlock }
  | { loop: LoopStep };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const InputFieldSchema: z.ZodType<InputField> = z.lazy(() =>
  z
    .strictObject({
      type: z.enum([
        'string',
        'number',
        'integer',
        'boolean',
        'array',
        'object',
      ]),
      description: z.string().optional(),
      enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
      items: InputFieldSchema.optional(),
      properties: z.record(z.string(), InputFieldSchema).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.type === 'array' && !value.items) {
        ctx.addIssue({
          code: 'custom',
          message: 'Array inputs must declare "items"',
          path: ['items'],
        });
      }
      if (value.type !== 'array' && value.items) {
        ctx.addIssue({
          code: 'custom',
          message: '"items" is only valid when type is "array"',
          path: ['items'],
        });
      }
      if (value.type !== 'object' && value.properties) {
        ctx.addIssue({
          code: 'custom',
          message: '"properties" is only valid when type is "object"',
          path: ['properties'],
        });
      }
    }),
);
// Retry policy: exponential backoff per attempt, capped by max_delay_ms, with optional jitter multiplier.
const RetriesSchema = z.strictObject({
  enabled: z.boolean().optional().meta({
    title: 'Enabled',
    description:
      'Enable retry attempts when an action fails (disabled = no retries).',
  }),
  max_attempts: z
    .int()
    .min(1)
    .default(DEFAULT_RETRY_SETTINGS.max_attempts)
    .meta({
      title: 'Max Attempts',
      description: 'Total number of attempts before giving up.',
    }),
  backoff_ms: z.int().min(0).default(DEFAULT_RETRY_SETTINGS.backoff_ms).meta({
    title: 'Initial Backoff (ms)',
    description: 'Delay in milliseconds before the first retry.',
  }),
  max_delay_ms: z
    .int()
    .min(0)
    .default(DEFAULT_RETRY_SETTINGS.max_delay_ms)
    .meta({
      title: 'Max Delay (ms)',
      description: 'Maximum delay cap in milliseconds between retries.',
    }),
  jitter: z.number().min(0).default(DEFAULT_RETRY_SETTINGS.jitter).meta({
    title: 'Jitter',
    description: 'Randomization factor applied to retry delays (0 = none).',
  }),
  multiplier: z
    .number()
    .min(1)
    .default(DEFAULT_RETRY_SETTINGS.multiplier)
    .meta({
      title: 'Backoff Multiplier',
      description: 'Multiplier applied to the delay after each retry.',
    }),
});

// Shared execution settings applied to every action invocation.
export const BaseSettingsSchema = z.strictObject({
  timeout_ms: z.int().nonnegative().optional().meta({
    title: 'Timeout (ms)',
    description:
      'Maximum runtime in milliseconds for a single action invocation (0 = disabled).',
  }),
  retries: RetriesSchema.optional().meta({
    title: 'Retries',
    description: 'Retry policy applied when an action fails.',
  }),
  stop_step_count: z.int().positive().max(MAX_STEP_BUDGET).optional().meta({
    title: 'Stop step count',
    description:
      'Maximum number of agent steps before stopping. Applies to AI agent steps; can be overridden per step.',
    default: DEFAULT_STEP_BUDGET,
  }),
});

export const SettingsSchema = BaseSettingsSchema.catchall(JsonValueSchema);

const TaskBindingReferenceSchema = z.union([z.string(), z.array(z.string())]);
const TaskBindingsSchema = z.record(z.string(), TaskBindingReferenceSchema);

export const TASK_KIND = 'task' as const;

export const TaskDefinitionSchema = z.strictObject({
  kind: z.literal(TASK_KIND),
  description: z.string().optional(),
  action: z.string(),
  inputs: z.record(z.string(), JsonValueSchema).optional(),
  bindings: TaskBindingsSchema.optional(),
  settings: SettingsSchema.optional(),
});

const NonTaskDefinitionSchema = z.strictObject({
  kind: z
    .string()
    .refine(
      (kind) => kind !== TASK_KIND,
      `kind "${TASK_KIND}" must follow the task definition shape.`,
    ),
  description: z.string().optional(),
  action: z.string().optional(),
  settings: z.record(z.string(), z.unknown()),
  bindings: TaskBindingsSchema.optional(),
});

export const DefDefinitionSchema = z.union([
  TaskDefinitionSchema,
  NonTaskDefinitionSchema,
]);
const ConditionalWhenSchema: z.ZodType<ConditionalBranch> = z.lazy(() =>
  z.strictObject({
    condition: ExpressionStringSchema,
    steps: z.array(FlowStepSchema),
  }),
);
const ConditionalElseSchema: z.ZodType<ConditionalBranch> = z.lazy(() =>
  z.strictObject({
    else: z.unknown().optional(),
    steps: z.array(FlowStepSchema),
  }),
);
const ConditionalSchema: z.ZodType<{
  description?: string;
  when: ConditionalBranch[];
}> = z.strictObject({
  description: z.string().optional(),
  when: z.array(z.union([ConditionalWhenSchema, ConditionalElseSchema])).min(1),
});
const ParallelSchema: z.ZodType<ParallelBlock> = z.strictObject({
  description: z.string().optional(),
  strategy: z.enum(['wait_all', 'wait_any']).optional(),
  steps: z.array(z.lazy(() => FlowStepSchema)),
});
const LoopAccumulateSchema: z.ZodType<LoopAccumulate> = z.strictObject({
  as: z.string(),
  initial: JsonValueSchema,
  merge: ExpressionStringSchema,
});
const ForEachLoopSchema = z.strictObject({
  type: z.literal('for_each'),
  name: z.string().optional(),
  description: z.string().optional(),
  for_each: z.strictObject({
    item: z.string(),
    in: ExpressionStringSchema,
  }),
  max_concurrency: z.int().positive().optional(),
  until: ExpressionStringSchema.optional(),
  accumulate: LoopAccumulateSchema.optional(),
  steps: z.array(z.lazy(() => FlowStepSchema)),
});
const WhileLoopSchema = z.strictObject({
  type: z.literal('while'),
  name: z.string().optional(),
  description: z.string().optional(),
  while: ExpressionStringSchema,
  accumulate: LoopAccumulateSchema.optional(),
  steps: z.array(z.lazy(() => FlowStepSchema)),
});
const LoopSchema: z.ZodType<LoopStep> = z.lazy(() =>
  z.union([ForEachLoopSchema, WhileLoopSchema]),
);

export const FlowStepSchema: z.ZodType<FlowStep> = z.lazy(() =>
  z.union([
    z.strictObject({
      do: z.string(),
    }),
    z.strictObject({
      parallel: ParallelSchema,
    }),
    z.strictObject({
      conditional: ConditionalSchema,
    }),
    z.strictObject({
      loop: LoopSchema,
    }),
  ]),
);

export const WorkflowMetadataSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
});

const InputsSchema = z.strictObject({
  schema: z.record(z.string(), InputFieldSchema).optional(),
});
const DefaultsSchema = z.strictObject({
  settings: SettingsSchema.optional(),
});

export const WorkflowDefinitionSchema = z.strictObject({
  inputs: InputsSchema.optional(),
  context: z.record(z.string(), JsonValueSchema).optional(),
  defaults: DefaultsSchema.optional(),
  defs: z.record(
    z.string().regex(SNAKE_CASE_REGEX, 'Name must be snake_case'),
    DefDefinitionSchema,
  ),
  flow: z.array(FlowStepSchema),
  outputs: z.record(z.string(), ExpressionStringSchema),
});

export type Settings = z.infer<typeof SettingsSchema>;

export type Conditional = z.infer<typeof ConditionalSchema>;

export type TaskDefinition = z.infer<typeof TaskDefinitionSchema>;

export type DefDefinition = z.infer<typeof DefDefinitionSchema>;

export type DefDefinitions = z.infer<typeof WorkflowDefinitionSchema>['defs'];

export type TaskDefinitions = Record<string, TaskDefinition>;

export type WorkflowMetadata = z.infer<typeof WorkflowMetadataSchema>;

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

export type WorkflowValidationActionMetadata = {
  supportedBindings?: readonly string[];
  inputSchema?: z.ZodTypeAny;
  settingSchema?: z.ZodTypeAny;
};

export type ValidateWorkflowOptions = {
  bindingKinds?: BindingKindSchemas;
  actions?: Record<string, WorkflowValidationActionMetadata>;
};

export type WorkflowValidationResult =
  | { success: true; data: WorkflowDefinition }
  | { success: false; issues: WorkflowValidationIssue[] };

type TaskReference = {
  taskId: string;
  path: Array<string | number>;
};

const collectTaskReferences = (
  steps: FlowStep[],
  basePath: Array<string | number> = ['flow'],
): TaskReference[] => {
  const refs: TaskReference[] = [];

  steps.forEach((step, index) => {
    const stepPath = [...basePath, index];

    if ('do' in step) {
      refs.push({ taskId: step.do, path: [...stepPath, 'do'] });

      return;
    }

    if ('parallel' in step) {
      refs.push(
        ...collectTaskReferences(step.parallel.steps, [
          ...stepPath,
          'parallel',
          'steps',
        ]),
      );

      return;
    }

    if ('conditional' in step) {
      step.conditional.when.forEach((branch, branchIndex) => {
        refs.push(
          ...collectTaskReferences(branch.steps, [
            ...stepPath,
            'conditional',
            'when',
            branchIndex,
            'steps',
          ]),
        );
      });

      return;
    }

    if ('loop' in step) {
      refs.push(
        ...collectTaskReferences(step.loop.steps, [
          ...stepPath,
          'loop',
          'steps',
        ]),
      );
    }
  });

  return refs;
};

export const isTaskDefinition = (
  definition: DefDefinition,
): definition is TaskDefinition => definition.kind === TASK_KIND;

export const extractTaskDefinitions = (defs: DefDefinitions): TaskDefinitions =>
  Object.entries(defs).reduce<TaskDefinitions>((tasks, [defName, def]) => {
    if (isTaskDefinition(def)) {
      tasks[defName] = def;
    }

    return tasks;
  }, {});

const EXECUTION_SETTING_KEYS = new Set(Object.keys(BaseSettingsSchema.shape));
const isExpressionString = (value: unknown): boolean =>
  typeof value === 'string' && value.startsWith('=');
const toIssuePath = (path: readonly PropertyKey[]): Array<string | number> =>
  path.filter(
    (segment): segment is string | number =>
      typeof segment === 'string' || typeof segment === 'number',
  );
const getValueAtPath = (
  value: unknown,
  path: Array<string | number>,
): unknown => {
  let current = value;

  for (const segment of path) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }

    current = (current as Record<string | number, unknown>)[segment];
  }

  return current;
};
const extractActionSettings = (settings: unknown): Record<string, unknown> => {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) => !EXECUTION_SETTING_KEYS.has(key),
    ),
  );
};
const toActionSchemaIssues = ({
  actionName,
  code,
  payload,
  schema,
  section,
  taskId,
}: {
  actionName: string;
  code: 'action_inputs' | 'action_settings';
  payload: unknown;
  schema: z.ZodTypeAny;
  section: 'inputs' | 'settings';
  taskId: string;
}): WorkflowValidationIssue[] => {
  const result = schema.safeParse(payload);

  if (result.success) {
    return [];
  }

  return result.error.issues.flatMap<WorkflowValidationIssue>((issue) => {
    const issuePath = toIssuePath(issue.path);

    // Expressions are resolved immediately before action execution, so their
    // eventual runtime type cannot be checked while validating the definition.
    if (isExpressionString(getValueAtPath(payload, issuePath))) {
      return [];
    }

    const path = ['defs', taskId, section, ...issuePath];

    return [
      {
        actionName,
        code,
        message: `${path.join('.')}: ${issue.message}`,
        path,
        taskId,
      },
    ];
  });
};
const validateTaskActionSchemas = (
  definition: WorkflowDefinition,
  actions?: Record<string, WorkflowValidationActionMetadata>,
): WorkflowValidationIssue[] => {
  if (!actions) {
    return [];
  }

  const issues: WorkflowValidationIssue[] = [];
  const taskDefinitions = extractTaskDefinitions(definition.defs);

  for (const [taskId, task] of Object.entries(taskDefinitions)) {
    const action = actions[task.action];

    // Missing actions are reported by binding validation and have no schemas
    // available for payload validation.
    if (!action) {
      continue;
    }

    if (action.inputSchema) {
      issues.push(
        ...toActionSchemaIssues({
          actionName: task.action,
          code: 'action_inputs',
          payload: task.inputs ?? {},
          schema: action.inputSchema,
          section: 'inputs',
          taskId,
        }),
      );
    }

    if (action.settingSchema) {
      const effectiveSettings = mergeSettings(
        definition.defaults?.settings,
        task.settings,
      );

      issues.push(
        ...toActionSchemaIssues({
          actionName: task.action,
          code: 'action_settings',
          payload: extractActionSettings(effectiveSettings),
          schema: action.settingSchema,
          section: 'settings',
          taskId,
        }),
      );
    }
  }

  return issues;
};
const toSchemaIssues = (zodIssues: z.ZodIssue[]): WorkflowValidationIssue[] =>
  zodIssues.map((issue) => {
    const path = issue.path.join('.') || '<root>';

    return {
      code: 'schema',
      message: `${path}: ${issue.message}`,
      path: issue.path.filter(
        (segment): segment is string | number =>
          typeof segment === 'string' || typeof segment === 'number',
      ),
    };
  });
const invalidWorkflow = (
  issues: WorkflowValidationIssue[],
): WorkflowValidationResult => ({
  success: false,
  issues,
});

export function validateWorkflow(
  input: string | unknown,
  options?: ValidateWorkflowOptions,
): WorkflowValidationResult {
  let candidate: unknown = input;

  if (typeof input === 'string') {
    try {
      candidate = parseYaml(input);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown YAML parse error';

      return invalidWorkflow([
        { code: 'yaml_parse', message: 'Unable to parse workflow YAML' },
        { code: 'yaml_parse', message },
      ]);
    }
  }

  const parsed = WorkflowDefinitionSchema.safeParse(candidate);

  if (!parsed.success) {
    return invalidWorkflow(toSchemaIssues(parsed.error.issues));
  }

  const issues: WorkflowValidationIssue[] = [];
  const taskDefinitions = extractTaskDefinitions(parsed.data.defs);
  const reportedMissingTasks = new Set<string>();

  for (const { taskId, path } of collectTaskReferences(parsed.data.flow)) {
    if (
      Object.prototype.hasOwnProperty.call(taskDefinitions, taskId) ||
      reportedMissingTasks.has(taskId)
    ) {
      continue;
    }

    reportedMissingTasks.add(taskId);
    issues.push({
      code: 'unknown_task',
      message: `Unknown task(s) referenced in flow: ${taskId}`,
      path,
      taskId,
    });
  }

  const bindingValidation = validateAndResolveBindings(parsed.data, {
    bindingKinds: options?.bindingKinds,
    actions: options?.actions,
  });

  issues.push(...bindingValidation.issues);
  issues.push(...validateTaskActionSchemas(parsed.data, options?.actions));

  if (issues.length > 0) {
    return invalidWorkflow(issues);
  }

  return { success: true, data: parsed.data };
}
