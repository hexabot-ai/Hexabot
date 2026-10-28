/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowRun, WorkflowRunFull } from "@hexabot-ai/types";
import { useState } from "react";

import { useGet } from "@/hooks/crud/useGet";
import { EntityType, Format } from "@/services/types";

import {
  useWorkflowRunOperator,
  type WorkflowRunOperatorVariables,
} from "../../hooks/useWorkflowRunOperator";
import {
  getOperatorErrorDescriptor,
  type OperatorErrorDescriptor,
} from "../../operator.utils";

/**
 * Follow a run as cached while a dialog about it is open: socket updates and
 * other admins' decisions land there.
 */
export const useLiveRun = <T extends WorkflowRun | WorkflowRunFull>(
  run: T,
): T | WorkflowRun => {
  const { data } = useGet(
    run.id,
    { entity: EntityType.WORKFLOW_RUN, format: Format.BASIC },
    { enabled: false },
  );

  return data ?? run;
};

/**
 * Submit an operator request from a dialog: close it with the returned run,
 * keep it open with the error of a refused payload (the run still waits on
 * the same wait), and close it on any other error, which
 * `useWorkflowRunOperator` reports.
 */
export const useOperatorSubmit = (
  onClose: (result: WorkflowRunFull | undefined) => Promise<void>,
) => {
  const { mutateAsync, isPending, variables } = useWorkflowRunOperator();
  const [error, setError] = useState<OperatorErrorDescriptor | null>(null);
  const submit = async (nextVariables: WorkflowRunOperatorVariables) => {
    setError(null);

    try {
      const run = await mutateAsync(nextVariables);

      await onClose(run);
    } catch (caught) {
      const descriptor = getOperatorErrorDescriptor(caught);

      if (descriptor.inline) {
        setError(descriptor);
      } else {
        await onClose(undefined);
      }
    }
  };

  return {
    submit,
    isPending,
    pendingAction: isPending ? variables?.action : undefined,
    error,
  };
};
