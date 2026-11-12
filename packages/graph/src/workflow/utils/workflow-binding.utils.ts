/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type {
  WorkflowBindingAddPayload,
  WorkflowBindingRemovePayload,
} from "../types/workflow-node.types";
import type { FlowStepPath } from "../types/workflow-path.types";

type BindingNodeFields = {
  stepId?: string;
  stepPath?: FlowStepPath;
  ownerDefName?: string;
  bindingKind?: string;
};

/** What adding a binding at a binding placeholder needs, when it has it all. */
export const getBindingAddPayload = (
  nodeId: string,
  { stepId, stepPath, ownerDefName, bindingKind }: BindingNodeFields,
): WorkflowBindingAddPayload | undefined =>
  stepId && stepPath && ownerDefName && bindingKind
    ? { nodeId, stepId, stepPath, ownerDefName, bindingKind }
    : undefined;

/**
 * What removing a mounted binding needs, when the node has it all. The
 * binding is removed from the owner's `ownerBindingKind` slot, which differs
 * from the node's own `bindingKind` when a def of another kind is mounted.
 */
export const getBindingRemovalPayload = (
  nodeId: string,
  {
    stepId,
    stepPath,
    ownerDefName,
    ownerBindingKind,
    bindingKind,
    bindingName,
  }: BindingNodeFields & { ownerBindingKind?: string; bindingName?: string },
): WorkflowBindingRemovePayload | undefined => {
  const slotKind = ownerBindingKind ?? bindingKind;

  return stepId && stepPath && ownerDefName && slotKind && bindingName
    ? {
        nodeId,
        stepId,
        stepPath,
        ownerDefName,
        bindingKind: slotKind,
        bindingName,
      }
    : undefined;
};
