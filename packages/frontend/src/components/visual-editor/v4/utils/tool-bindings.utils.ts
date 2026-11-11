/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  type DefDefinition,
  JsonValue,
  type WorkflowDefinition,
} from "@hexabot-ai/agentic";

import { isDefinitionNameAvailable } from "./definition-name.utils";
import {
  mountDefBindingRef,
  renameDefBindingRefs,
} from "./task-bindings.utils";

export const TOOL_BINDING_KIND = "tools";

type WorkflowDefs = NonNullable<WorkflowDefinition["defs"]>;
const sanitizeToolDescription = (value?: string): string | undefined => {
  const normalized = value?.trim() ?? "";

  return normalized || undefined;
};
const sanitizeToolSettings = (
  value?: Record<string, unknown>,
): Record<string, JsonValue> => {
  if (!value || Object.keys(value).length === 0) {
    return {};
  }

  return value as Record<string, JsonValue>;
};
const createToolDefinition = ({
  actionName,
  description,
  settings,
}: {
  actionName: string;
  description?: string;
  settings?: Record<string, unknown>;
}): WorkflowDefs[string] => {
  const normalizedDescription = sanitizeToolDescription(description);
  const normalizedSettings = sanitizeToolSettings(settings);

  return {
    kind: TOOL_BINDING_KIND,
    action: actionName,
    ...(normalizedDescription ? { description: normalizedDescription } : {}),
    settings: normalizedSettings,
  };
};

export type CreateToolBindingDefinitionMutationArgs = {
  ownerDefName: string;
  bindingKind: string;
  bindingName: string;
  actionName: string;
  description?: string;
  settings?: Record<string, unknown>;
};

export const createToolBindingDefinitionMutation = (
  definition: WorkflowDefinition,
  {
    ownerDefName,
    bindingKind,
    bindingName,
    actionName,
    description,
    settings,
  }: CreateToolBindingDefinitionMutationArgs,
): WorkflowDefinition => {
  const ownerDefinition = definition.defs[ownerDefName];

  if (!ownerDefinition) {
    return definition;
  }

  const currentDefs = definition.defs ?? {};

  if (!isDefinitionNameAvailable(bindingName, currentDefs)) {
    return definition;
  }

  const nextOwnerDefinition = mountDefBindingRef(
    ownerDefinition,
    bindingKind,
    bindingName,
    true,
  );

  if (nextOwnerDefinition === ownerDefinition) {
    return definition;
  }

  return {
    ...definition,
    defs: {
      ...currentDefs,
      [bindingName]: createToolDefinition({
        actionName,
        description,
        settings,
      }),
      [ownerDefName]: nextOwnerDefinition,
    },
  };
};

export type UpdateToolBindingDefinitionMutationArgs = {
  ownerDefName: string;
  bindingKind: string;
  currentBindingName: string;
  nextBindingName: string;
  actionName: string;
  description?: string;
  settings?: Record<string, unknown>;
};

export const updateToolBindingDefinitionMutation = (
  definition: WorkflowDefinition,
  {
    bindingKind,
    currentBindingName,
    nextBindingName,
    actionName,
    description,
    settings,
  }: UpdateToolBindingDefinitionMutationArgs,
): WorkflowDefinition => {
  const currentDefs = definition.defs ?? {};
  const currentDef = currentDefs[currentBindingName];

  if (!currentDef) {
    return definition;
  }

  if (
    !isDefinitionNameAvailable(nextBindingName, currentDefs, currentBindingName)
  ) {
    return definition;
  }

  const nextDefs = { ...currentDefs };

  if (currentBindingName !== nextBindingName) {
    delete nextDefs[currentBindingName];
  }

  const nextToolDefinition = createToolDefinition({
    actionName,
    description,
    settings,
  }) as DefDefinition;
  const currentBindings = currentDef.bindings;

  nextDefs[nextBindingName] = {
    ...nextToolDefinition,
    ...(currentBindings ? { bindings: currentBindings } : {}),
  };

  return {
    ...definition,
    defs: renameDefBindingRefs(
      nextDefs,
      bindingKind,
      currentBindingName,
      nextBindingName,
      true,
    ),
  };
};
