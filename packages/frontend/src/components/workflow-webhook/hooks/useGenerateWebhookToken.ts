/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { useTanstackMutation } from "@/hooks/crud/useTanstack";
import { useApiClient } from "@/hooks/useApiClient";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";

export type WebhookTokenResult = {
  token: string;
};

export const useGenerateWebhookToken = (workflowId?: string) => {
  const { apiClient } = useApiClient();
  const { toast } = useToast();
  const { t } = useTranslate();
  const {
    mutate: generateToken,
    data: tokenResult,
    isPending,
    reset,
  } = useTanstackMutation<WebhookTokenResult, Error, void>({
    mutationFn: async () => {
      if (!workflowId) {
        throw new Error(t("message.unable_to_process_request"));
      }

      const { _csrf } = await apiClient.getCsrf();
      const { data } = await apiClient
        .getRequest()
        .post<WebhookTokenResult>(`/workflow/${workflowId}/webhook-token`, {
          _csrf,
        });

      return data;
    },
    onError: (error) => {
      toast.error(error);
    },
  });

  return { generateToken, tokenResult, isPending, reset };
};
