/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ConfirmDialogBody } from "@/app-components/dialogs";
import { useDelete } from "@/hooks/crud/useDelete";
import { useAuth } from "@/hooks/useAuth";
import { useDialogs } from "@/hooks/useDialogs";
import { EntityType } from "@/services/types";

import { useWorkflow } from "./useWorkflow";

/**
 * Deletes a workflow once confirmed and, when it was the selected one,
 * switches the editor to another workflow.
 */
export const useConfirmDeleteWorkflow = () => {
  const dialogs = useDialogs();
  const { refetchUser } = useAuth();
  const { workflows, selectedFlowId, updateWorkflowURL } = useWorkflow();
  const { mutate: deleteWorkflow } = useDelete(EntityType.WORKFLOW);

  return async (flowId: string) => {
    const fallbackFlowId = workflows?.find((flow) => flow.id !== flowId)?.id;
    const isConfirmed = await dialogs.confirm(ConfirmDialogBody);

    if (!isConfirmed) {
      return;
    }

    deleteWorkflow(flowId, {
      onSuccess: () => {
        void refetchUser();
        if (selectedFlowId === flowId && fallbackFlowId) {
          updateWorkflowURL(fallbackFlowId);
        }
      },
    });
  };
};
