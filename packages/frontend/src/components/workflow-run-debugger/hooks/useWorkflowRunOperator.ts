/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus } from "@hexabot-ai/agentic";
import type { WorkflowRunFull } from "@hexabot-ai/types";
import { useCallback } from "react";

import { useNormalizeAndCache } from "@/hooks/crud/helpers";
import {
  useTanstackMutation,
  useTanstackQueryClient,
} from "@/hooks/crud/useTanstack";
import { getApiClientQueryKey, useApiClient } from "@/hooks/useApiClient";
import { invalidatePendingWorkflowRuns } from "@/hooks/usePendingWorkflowRunsSync";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import type {
  WorkflowRunCancelPayload,
  WorkflowRunDecisionPayload,
  WorkflowRunResumePayload,
} from "@/services/api.class";
import { EntityType, QueryType } from "@/services/types";

import {
  getOperatorErrorDescriptor,
  getOperatorOutcome,
  type OperatorErrorDescriptor,
  type OperatorOutcome,
} from "../operator.utils";

export type WorkflowRunOperatorVariables =
  | {
      action: "approve" | "reject";
      runId: string;
      body: WorkflowRunDecisionPayload;
    }
  | { action: "resume"; runId: string; body: WorkflowRunResumePayload }
  | { action: "cancel"; runId: string; body: WorkflowRunCancelPayload };

/**
 * Translate the messages of operator outcomes and errors.
 */
export const useOperatorMessages = () => {
  const { t } = useTranslate();
  const formatOutcome = useCallback(
    ({ key, params, detail }: OperatorOutcome) =>
      [t(key, params), detail ? t(detail.key, detail.params) : ""]
        .filter(Boolean)
        .join(" "),
    [t],
  );
  const formatError = useCallback(
    ({ key, params, fallback }: OperatorErrorDescriptor) =>
      t(key, params) || fallback || t("message.internal_server_error"),
    [t],
  );

  return { formatOutcome, formatError };
};

/**
 * Approve, reject, resume or cancel a suspended run.
 *
 * Each call resolves with the run once its resumed pass settled (it may wait
 * again, finish or fail). The returned run is cached and the pending lists
 * are refreshed; failures are reported, except a refused resume payload,
 * which the caller shows next to its form (`descriptor.inline`).
 */
export const useWorkflowRunOperator = () => {
  const queryClient = useTanstackQueryClient();
  const { apiClient } = useApiClient();
  const { toast } = useToast();
  const { formatOutcome, formatError } = useOperatorMessages();
  const normalizeAndCache = useNormalizeAndCache<string>(
    EntityType.WORKFLOW_RUN,
  );
  const refreshRun = useCallback(
    (runId: string) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: [QueryType.item, EntityType.WORKFLOW_RUN, runId],
          exact: true,
        }),
        invalidatePendingWorkflowRuns(queryClient),
      ]),
    [queryClient],
  );

  return useTanstackMutation<
    WorkflowRunFull,
    unknown,
    WorkflowRunOperatorVariables
  >({
    mutationFn: async ({ action, runId, body }) => {
      switch (action) {
        case "approve":
          return await apiClient.approveWorkflowRun(runId, body);
        case "reject":
          return await apiClient.rejectWorkflowRun(runId, body);
        case "resume":
          return await apiClient.resumeWorkflowRun(runId, body);
        case "cancel":
          return await apiClient.cancelWorkflowRun(runId, body);
      }
    },
    onSuccess: (run, { action }) => {
      normalizeAndCache(run);
      void invalidatePendingWorkflowRuns(queryClient);

      if (run.status === EWorkflowRunStatus.FAILED) {
        void queryClient.invalidateQueries({
          queryKey: getApiClientQueryKey("getFailedWorkflowRunsLast24h"),
        });
      }

      const outcome = getOperatorOutcome(run, action);

      toast[outcome.severity](formatOutcome(outcome));
    },
    onError: (error, { runId }) => {
      const descriptor = getOperatorErrorDescriptor(error);

      if (descriptor.refreshRun) {
        void refreshRun(runId);
      }

      if (!descriptor.inline && !descriptor.silent) {
        toast[descriptor.severity](formatError(descriptor));
      }
    },
  });
};
