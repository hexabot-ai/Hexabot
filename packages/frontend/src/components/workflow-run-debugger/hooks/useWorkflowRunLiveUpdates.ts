/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowRun } from "@hexabot-ai/types";
import { useCallback } from "react";

import { useTanstackQueryClient } from "@/hooks/crud/useTanstack";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType, QueryType } from "@/services/types";
import type { SubscribeWorkflowProps } from "@/websocket/types/workflow.types";
import { useWorkflowEventSubscription } from "@/websocket/workflow-event-hooks";

import {
  getResumeRejectionMessage,
  isWorkflowRunLiveEventForDebugger,
  mergeWorkflowRunLiveEvent,
  shouldWorkflowRunLiveEventTouchQuery,
} from "../live-workflow-run.utils";

type UseWorkflowRunLiveUpdatesProps = {
  workflowId?: string;
  initiatorId?: string;
};

export const useWorkflowRunLiveUpdates = ({
  workflowId,
  initiatorId,
}: UseWorkflowRunLiveUpdatesProps) => {
  const queryClient = useTanstackQueryClient();
  const { toast } = useToast();
  const { t } = useTranslate();
  const handleWorkflowEvent = useCallback(
    (event: SubscribeWorkflowProps) => {
      if (!isWorkflowRunLiveEventForDebugger(event, workflowId, initiatorId)) {
        return;
      }

      const runId = event.workflowRun?.id ?? event.runId;

      if (!runId) {
        return;
      }

      const rejectionMessage = getResumeRejectionMessage(event);

      // The trigger request was accepted, so the refusal only shows up here.
      if (rejectionMessage !== undefined) {
        toast.warning(
          t("message.workflow_resume_rejected", { "0": rejectionMessage }),
        );
      }

      queryClient.setQueryData(
        [QueryType.item, EntityType.WORKFLOW_RUN, runId],
        (previousRun) =>
          mergeWorkflowRunLiveEvent(
            previousRun as WorkflowRun | undefined,
            event,
          ),
      );

      queryClient.setQueriesData(
        {
          predicate: ({ queryKey }) =>
            shouldWorkflowRunLiveEventTouchQuery(queryKey, event),
        },
        (collection) => {
          if (!Array.isArray(collection)) {
            return collection ? structuredClone(collection) : collection;
          }

          return collection.includes(runId)
            ? [...collection]
            : [runId, ...collection];
        },
      );
    },
    [initiatorId, queryClient, t, toast, workflowId],
  );

  useWorkflowEventSubscription(handleWorkflowEvent);
};
