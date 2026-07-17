/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  DEFAULT_RETRY_SETTINGS,
  DEFAULT_TIMEOUT_MS,
  type TaskDefinition,
  type WorkflowDefinition,
  extractTaskDefinitions,
  isSnakeCaseName,
  toSnakeCase,
} from "@hexabot-ai/agentic";
import { parse as parseYaml } from "yaml";

import { isRecord } from "@/utils/object";

/**
 * Build a minimal workflow definition with defaults and optional metadata.
 */
export const createBaseDefinition = (): WorkflowDefinition => ({
  defaults: {
    settings: {
      timeout_ms: DEFAULT_TIMEOUT_MS,
      retries: { ...DEFAULT_RETRY_SETTINGS },
    },
  },
  defs: {},
  flow: [],
  outputs: {},
});

/**
 * Normalize user input into a valid snake_case task identifier.
 */
export const normalizeTaskName = (value: string): string => {
  const snakeCaseName = toSnakeCase(value.trim());

  if (!snakeCaseName) {
    return "";
  }

  if (isSnakeCaseName(snakeCaseName)) {
    return snakeCaseName;
  }

  const fallbackName = `${snakeCaseName}_task`;

  return isSnakeCaseName(fallbackName) ? fallbackName : "";
};

/**
 * Generate a unique task name derived from the action name.
 */
export const createTaskName = (
  actionName: string,
  defs: WorkflowDefinition["defs"],
  taskDefinitions?: Record<string, TaskDefinition>,
) => {
  const tasks = taskDefinitions ?? extractTaskDefinitions(defs ?? {});
  const baseName = normalizeTaskName(actionName) || "new_task";
  const normalizedBase = isSnakeCaseName(baseName) ? baseName : "new_task";
  let candidate = normalizedBase;
  let suffix = 2;

  while (Object.prototype.hasOwnProperty.call(tasks, candidate)) {
    candidate = `${normalizedBase}_${suffix}`;
    suffix += 1;
  }

  return candidate;
};
export const extractDefsFromYaml = (yaml: string): Record<string, unknown> => {
  try {
    const parsed = parseYaml(yaml);

    return isRecord(parsed) && isRecord(parsed.defs) ? parsed.defs : {};
  } catch {
    return {};
  }
};
export const extractDefinitionNamesByKind = (
  defs: Record<string, unknown>,
  kind: string,
): string[] =>
  Object.keys(defs).filter((name) => {
    const definition = defs[name];

    return isRecord(definition) && definition.kind === kind;
  });
