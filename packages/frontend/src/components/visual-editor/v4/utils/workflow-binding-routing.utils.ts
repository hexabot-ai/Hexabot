/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowDefinition } from "@hexabot-ai/agentic";
import { ENodeType } from "@hexabot-ai/graph";

import type { WorkflowBindingDefinition } from "@/contexts/workflow-bindings.context";

import { toBindingRefs } from "./task-bindings.utils";
import { TOOL_BINDING_KIND } from "./tool-bindings.utils";

export const isNonToolBindingKind = (
  bindingKind: string,
  bindingsByName: ReadonlyMap<string, WorkflowBindingDefinition>,
): boolean => {
  return bindingKind !== TOOL_BINDING_KIND && bindingsByName.has(bindingKind);
};

type GetDisabledBindingRefsArgs = {
  definition: WorkflowDefinition;
  ownerDefName: string;
  bindingKind: string;
  bindingsByName: ReadonlyMap<string, WorkflowBindingDefinition>;
};

export const getDisabledBindingRefs = ({
  definition,
  ownerDefName,
  bindingKind,
  bindingsByName,
}: GetDisabledBindingRefsArgs): string[] => {
  if (!isNonToolBindingKind(bindingKind, bindingsByName)) {
    return [];
  }

  const bindingDefinition = bindingsByName.get(bindingKind);

  if (!bindingDefinition) {
    return [];
  }

  const multiple = bindingDefinition.multiple ?? true;

  if (!multiple) {
    return [];
  }

  const ownerDefinition = definition.defs[ownerDefName];

  if (!ownerDefinition) {
    return [];
  }

  return toBindingRefs(ownerDefinition.bindings?.[bindingKind], true);
};

export type BindingNodeTarget =
  | { drawer: "tool"; ownerDefName: string; bindingName: string }
  | { drawer: "binding"; bindingKind: string; bindingName: string };

/**
 * The drawer a click on a graph node opens: the tool drawer for a tool binding,
 * the binding drawer for a non-tool binding (of the kind its definition
 * declares), nothing for other nodes or incomplete node data.
 */
export const getBindingNodeTarget = (
  node: { type?: string; data?: unknown },
  defs: WorkflowDefinition["defs"] | undefined,
  bindingsByName: ReadonlyMap<string, WorkflowBindingDefinition>,
): BindingNodeTarget | undefined => {
  if (
    node.type !== ENodeType.BINDING_MULTI &&
    node.type !== ENodeType.BINDING_SINGLE
  ) {
    return undefined;
  }

  const nodeData =
    node.data && typeof node.data === "object"
      ? (node.data as Record<string, unknown>)
      : undefined;
  const bindingKind = nodeData?.bindingKind;
  const bindingName = nodeData?.bindingName;
  const ownerDefName = nodeData?.ownerDefName;

  if (
    node.type === ENodeType.BINDING_MULTI &&
    bindingKind === TOOL_BINDING_KIND
  ) {
    return typeof bindingName === "string" && typeof ownerDefName === "string"
      ? { drawer: "tool", ownerDefName, bindingName }
      : undefined;
  }

  if (typeof bindingKind !== "string" || typeof bindingName !== "string") {
    return undefined;
  }

  const resolvedBindingKind = defs?.[bindingName]?.kind ?? bindingKind;

  return isNonToolBindingKind(resolvedBindingKind, bindingsByName)
    ? { drawer: "binding", bindingKind: resolvedBindingKind, bindingName }
    : undefined;
};
