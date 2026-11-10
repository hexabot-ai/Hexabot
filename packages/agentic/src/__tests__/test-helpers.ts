/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type {
  DefDefinition,
  TaskDefinition,
  WorkflowDefinition,
} from '../dsl.types';

const createTaskDef = (
  definition: Omit<TaskDefinition, 'kind'>,
): TaskDefinition => ({
  kind: 'task',
  ...definition,
});

export const createTaskDefs = (
  tasks: Record<string, Omit<TaskDefinition, 'kind'>>,
): WorkflowDefinition['defs'] =>
  Object.fromEntries(
    Object.entries(tasks).map(([taskName, taskDefinition]) => [
      taskName,
      createTaskDef(taskDefinition),
    ]),
  );

export const mergeTaskDefs = (
  tasks: Record<string, Omit<TaskDefinition, 'kind'>>,
  defs: Record<string, DefDefinition> = {},
): WorkflowDefinition['defs'] => ({
  ...defs,
  ...createTaskDefs(tasks),
});
