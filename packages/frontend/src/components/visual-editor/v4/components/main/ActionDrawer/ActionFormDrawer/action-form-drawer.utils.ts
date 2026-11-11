/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  BaseSettingsSchema,
  DEFAULT_RETRY_SETTINGS,
  DEFAULT_TIMEOUT_MS,
  JsonValue,
  Settings,
  TaskDefinition,
  Workflow as WorkflowHelper,
  mergeSettings,
  type WorkflowDefinition,
} from "@hexabot-ai/agentic";

type SplitTaskSettingsResult = {
  actionSettings: Record<string, JsonValue>;
  executionSettings: Partial<Settings>;
  hasExecutionOverride: boolean;
};

export type TaskSettingsFormState = {
  actionSettings: Record<string, unknown>;
  executionSettings: Record<string, unknown>;
  usesWorkflowExecutionDefaults: boolean;
};

/** What the action form drawer saves into a task. */
export type TaskFormValues = {
  /** Already trimmed; an empty description removes the task's one. */
  description: string;
  inputs: Record<string, unknown>;
  /** The action settings, plus the execution settings when overridden. */
  settings: Record<string, unknown>;
};

const EXECUTION_SETTING_KEYS = new Set(Object.keys(BaseSettingsSchema.shape));
const DEFAULT_WORKFLOW_EXECUTION_SETTINGS: Partial<Settings> = {
  timeout_ms: DEFAULT_TIMEOUT_MS,
  retries: { ...DEFAULT_RETRY_SETTINGS },
};

export const splitTaskSettings = (
  settings: Record<string, unknown> | undefined,
): SplitTaskSettingsResult => {
  const actionSettings: Record<string, JsonValue> = {};
  const executionSettings: Partial<Settings> = {};

  if (!settings) {
    return {
      actionSettings,
      executionSettings,
      hasExecutionOverride: false,
    };
  }

  for (const [key, value] of Object.entries(settings)) {
    if (EXECUTION_SETTING_KEYS.has(key)) {
      executionSettings[key as keyof Settings] = value as JsonValue;
      continue;
    }

    actionSettings[key] = value as JsonValue;
  }

  return {
    actionSettings,
    executionSettings,
    hasExecutionOverride: Object.keys(executionSettings).length > 0,
  };
};

/** The execution settings of a task that follows the workflow defaults. */
export const getWorkflowExecutionDefaults = (
  workflowSettings: Record<string, unknown> | undefined,
): Partial<Settings> =>
  mergeSettings(
    DEFAULT_WORKFLOW_EXECUTION_SETTINGS,
    splitTaskSettings(workflowSettings).executionSettings,
  ) as Partial<Settings>;

/**
 * Split task settings between the action settings form and the execution
 * settings form. Execution settings the task does not override show the
 * workflow defaults.
 */
export const getTaskSettingsFormState = (
  settings: Record<string, unknown> | undefined,
  workflowExecutionDefaults: Partial<Settings>,
): TaskSettingsFormState => {
  const { actionSettings, executionSettings, hasExecutionOverride } =
    splitTaskSettings(settings);

  return {
    actionSettings,
    executionSettings: (hasExecutionOverride
      ? mergeSettings(workflowExecutionDefaults, executionSettings)
      : workflowExecutionDefaults) as Record<string, unknown>,
    usesWorkflowExecutionDefaults: !hasExecutionOverride,
  };
};

export const buildNewTask = (
  actionName: string,
  { description, inputs, settings }: TaskFormValues,
): TaskDefinition => ({
  kind: "task",
  action: actionName,
  ...(description ? { description } : {}),
  ...(Object.keys(inputs).length > 0
    ? { inputs: inputs as Record<string, JsonValue> }
    : {}),
  ...(Object.keys(settings).length > 0
    ? { settings: settings as TaskDefinition["settings"] }
    : {}),
});

/**
 * Save the form values into an existing task, renamed to `nextTaskName`. The
 * inputs and settings are written when the form has some or the task already
 * had them, so emptying them leaves `{}` rather than dropping the key.
 */
export const applyTaskEdits = (
  definition: WorkflowDefinition,
  taskName: string,
  nextTaskName: string,
  currentTask: TaskDefinition,
  { description, inputs, settings }: TaskFormValues,
): WorkflowDefinition => {
  const nextTask: TaskDefinition = {
    ...currentTask,
    ...(description ? { description } : {}),
    ...(Object.keys(inputs).length > 0 || currentTask.inputs !== undefined
      ? { inputs: inputs as Record<string, JsonValue> }
      : {}),
    ...(Object.keys(settings).length > 0 || currentTask.settings !== undefined
      ? { settings: settings as TaskDefinition["settings"] }
      : {}),
  };

  if (!description) {
    delete nextTask.description;
  }

  const nextDefinition: WorkflowDefinition = {
    ...definition,
    defs: {
      ...(definition.defs ?? {}),
      [taskName]: nextTask,
    },
  };

  return nextTaskName === taskName
    ? nextDefinition
    : WorkflowHelper.safeRenameTaskInDefinition(
        nextDefinition,
        taskName,
        nextTaskName,
      );
};
