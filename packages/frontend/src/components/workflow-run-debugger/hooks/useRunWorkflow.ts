/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Workflow } from "@hexabot-ai/types";

import {
  useTanstackMutation,
  useTanstackQueryClient,
} from "@/hooks/crud/useTanstack";
import { useApiClient } from "@/hooks/useApiClient";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType, QueryType } from "@/services/types";

export const useRunWorkflow = (workflow?: Workflow | null) => {
  const queryClient = useTanstackQueryClient();
  const { apiClient } = useApiClient();
  const { toast } = useToast();
  const { t } = useTranslate();
  const { mutate: runWorkflow, isPending } = useTanstackMutation<
    { accepted: true },
    Error,
    Record<string, unknown> | undefined
  >({
    mutationFn: async (input) => {
      if (!workflow?.id) {
        throw new Error(t("message.unable_to_process_request"));
      }

      const payload = input ? { input } : {};
      const { _csrf } = await apiClient.getCsrf();
      const { data } = await apiClient
        .getRequest()
        .post<{ accepted: true }>(`/workflow/${workflow.id}/run`, {
          ...payload,
          _csrf,
        });

      return data;
    },
    onSuccess: () => {
      queryClient.refetchQueries({
        predicate: ({ queryKey }) => {
          const [queryType, queryEntity] = queryKey;

          return (
            (queryType === QueryType.collection ||
              queryType === QueryType.count) &&
            typeof queryEntity === "string" &&
            queryEntity.split("/")[0] === EntityType.WORKFLOW_RUN
          );
        },
      });
      toast.success(t("message.workflow_run_started"));
    },
    onError: (error) => {
      toast.error(error);
    },
  });

  return { runWorkflow, isPending };
};
