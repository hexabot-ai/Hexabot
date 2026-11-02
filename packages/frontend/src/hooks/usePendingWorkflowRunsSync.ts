/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { useCallback, useEffect, useRef } from "react";

import { useTanstackQueryClient } from "@/hooks/crud/useTanstack";
import { resolveEntityType } from "@/hooks/useEntityMutationSubscription";
import { EntityType, QueryType } from "@/services/types";
import type { QueryClient } from "@/types/tanstack.types";
import { isRecord } from "@/utils/object";
import { useSocket, useSubscribe } from "@/websocket/socket-hooks";

type EntityMutationEvent = {
  entity?: unknown;
  op?: unknown;
  data?: unknown;
};

const PENDING_QUERY_TYPES = [QueryType.collection, QueryType.count] as const;

/**
 * Refetch the lists and counts of runs waiting on an admin.
 */
export const invalidatePendingWorkflowRuns = async (
  queryClient: QueryClient,
) => {
  await Promise.all(
    PENDING_QUERY_TYPES.map((queryType) =>
      queryClient.invalidateQueries({
        queryKey: [queryType, EntityType.WORKFLOW_RUN_PENDING],
      }),
    ),
  );
};

/**
 * Tell whether a run is shown by a cached list of pending runs.
 */
export const isListedAsPending = (queryClient: QueryClient, runId: string) =>
  queryClient
    .getQueriesData<unknown>({
      queryKey: [QueryType.collection, EntityType.WORKFLOW_RUN_PENDING],
    })
    .some(([, ids]) => Array.isArray(ids) && ids.includes(runId));

/**
 * Tell whether an `entity` socket event may add a run to, or remove it from,
 * the runs waiting on an admin.
 *
 * Creations and deletions already refetch every workflow run list
 * (`useEntityMutationSubscription`). An update matters when the run waits on
 * an admin (it just suspended, or was claimed to resolve its wait: claims
 * keep `awaitingOperator`), or when a pending list still shows it.
 *
 * @param event - `entity` socket event.
 * @param isListed - Whether a cached pending list shows the run.
 */
export const shouldRefreshPendingRuns = (
  event: EntityMutationEvent,
  isListed: (runId: string) => boolean,
): boolean => {
  if (
    resolveEntityType(event.entity) !== EntityType.WORKFLOW_RUN ||
    event.op !== "update" ||
    !isRecord(event.data)
  ) {
    return false;
  }

  const { id, awaitingOperator } = event.data;

  return awaitingOperator === true || (typeof id === "string" && isListed(id));
};

/**
 * Keep the runs waiting on an admin (approvals page, sidebar badge,
 * dashboard) live: workflow run updates only patch the cached items, so the
 * pending lists and counts are refetched when a run enters or leaves them,
 * and after a reconnection, since missed events are not replayed.
 */
export const usePendingWorkflowRunsSync = () => {
  const queryClient = useTanstackQueryClient();
  const { connected } = useSocket();
  const hasConnected = useRef(false);
  const handleEntityMutation = useCallback(
    (event: EntityMutationEvent) => {
      if (
        shouldRefreshPendingRuns(event, (runId) =>
          isListedAsPending(queryClient, runId),
        )
      ) {
        void invalidatePendingWorkflowRuns(queryClient);
      }
    },
    [queryClient],
  );

  useSubscribe<EntityMutationEvent>("entity", handleEntityMutation);

  useEffect(() => {
    if (!connected) {
      return;
    }

    if (hasConnected.current) {
      void invalidatePendingWorkflowRuns(queryClient);
    }
    hasConnected.current = true;
  }, [connected, queryClient]);
};
