/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowDefinition } from "@hexabot-ai/agentic";

import { isDefinitionNameAvailable } from "./definition-name.utils";
import {
  renameDefBindingRefs,
  unmountDefBindingRef,
} from "./task-bindings.utils";

export type UpdateBindingDefinitionMutationArgs = {
  bindingKind: string;
  currentBindingName: string;
  nextBindingName: string;
  settings: Record<string, unknown>;
  description?: string;
  multiple: boolean;
};

/**
 * Save the settings and description of a non-tool binding definition, renamed
 * to `nextBindingName` along with the references to it. Returns `definition`
 * itself when the binding is missing, of another kind, or the name is taken.
 */
export const updateBindingDefinitionMutation = (
  definition: WorkflowDefinition,
  {
    bindingKind,
    currentBindingName,
    nextBindingName,
    settings,
    description,
    multiple,
  }: UpdateBindingDefinitionMutationArgs,
): WorkflowDefinition => {
  const currentDefs = definition.defs ?? {};
  const currentDef = currentDefs[currentBindingName];

  if (
    !currentDef ||
    currentDef.kind !== bindingKind ||
    !isDefinitionNameAvailable(nextBindingName, currentDefs, currentBindingName)
  ) {
    return definition;
  }

  const normalizedDescription = description?.trim() ?? "";
  const nextDefs = { ...currentDefs };

  if (currentBindingName !== nextBindingName) {
    delete nextDefs[currentBindingName];
  }

  const updatedDefinition = {
    ...currentDef,
    kind: bindingKind,
    settings,
    ...(normalizedDescription ? { description: normalizedDescription } : {}),
  };

  if (!normalizedDescription) {
    delete updatedDefinition.description;
  }

  nextDefs[nextBindingName] = updatedDefinition;

  return {
    ...definition,
    defs:
      currentBindingName !== nextBindingName
        ? renameDefBindingRefs(
            nextDefs,
            bindingKind,
            currentBindingName,
            nextBindingName,
            multiple,
          )
        : nextDefs,
  };
};

export type UnmountBindingMutationArgs = {
  ownerDefName: string;
  bindingKind: string;
  bindingName: string;
  multiple: boolean;
};

/**
 * Remove the `bindingName` reference from the bindings of `ownerDefName`.
 * Returns `definition` itself when the owner does not reference it.
 */
export const unmountBindingMutation = (
  definition: WorkflowDefinition,
  {
    ownerDefName,
    bindingKind,
    bindingName,
    multiple,
  }: UnmountBindingMutationArgs,
): WorkflowDefinition => {
  const ownerDefinition = definition.defs[ownerDefName];

  if (!ownerDefinition) {
    return definition;
  }

  const nextOwnerDefinition = unmountDefBindingRef(
    ownerDefinition,
    bindingKind,
    bindingName,
    multiple,
  );

  return nextOwnerDefinition === ownerDefinition
    ? definition
    : {
        ...definition,
        defs: {
          ...definition.defs,
          [ownerDefName]: nextOwnerDefinition,
        },
      };
};
