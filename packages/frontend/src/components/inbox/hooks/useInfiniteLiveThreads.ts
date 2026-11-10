/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Thread } from "@hexabot-ai/types";
import { useMemo } from "react";

import { useNormalizedInfiniteQuery } from "@/hooks/crud/useNormalizedInfiniteQuery";
import { useAuth } from "@/hooks/useAuth";
import { EntityType, Format } from "@/services/types";
import { SearchPayload } from "@/types/search.types";

import { AssignedTo } from "../types";

type ConversationsFilters = {
  sources: string[];
  searchPayload: SearchPayload<EntityType.SUBSCRIBER>;
  assignedTo: AssignedTo;
};

const mapFilterFieldToThreadFilter = (field: string) => {
  return field.startsWith("subscriber.") ? field : `subscriber.${field}`;
};
const mapOrClauses = (orClauses: unknown) => {
  if (!Array.isArray(orClauses)) {
    return undefined;
  }

  return orClauses
    .map((clause) => {
      if (!clause || typeof clause !== "object") {
        return null;
      }

      const [field, value] = Object.entries(clause)[0] ?? [];

      if (!field) {
        return null;
      }

      return {
        [mapFilterFieldToThreadFilter(field)]: value,
      };
    })
    .filter((clause): clause is Record<string, unknown> => clause !== null);
};
const mapSubscriberWhereToThreadWhere = (
  where: SearchPayload<EntityType.SUBSCRIBER>["where"] = {},
) => {
  const mappedWhere: Record<string, unknown> = {};

  Object.entries(where ?? {}).forEach(([field, value]) => {
    if (field === "or") {
      const mappedOrClauses = mapOrClauses(value);

      if (mappedOrClauses?.length) {
        mappedWhere.or = mappedOrClauses;
      }

      return;
    }

    mappedWhere[mapFilterFieldToThreadFilter(field)] = value;
  });

  return mappedWhere;
};

export const buildThreadSearchPayload = (
  props: ConversationsFilters,
  userId?: string,
) => {
  const subscriberWhere = {
    ...(props.searchPayload.where ?? {}),
    ...(props.assignedTo === AssignedTo.ME
      ? { "assignedTo.id": userId }
      : props.assignedTo === AssignedTo.OTHERS
        ? { "assignedTo.id": { "!=": userId } }
        : {}),
  };
  const where = mapSubscriberWhereToThreadWhere(subscriberWhere);

  return {
    where: {
      ...where,
      ...(props.sources.length > 0
        ? {
            "source.id": { $in: props.sources },
          }
        : {}),
    },
  } satisfies SearchPayload<EntityType.THREAD>;
};

export const useInfiniteLiveThreads = (props: ConversationsFilters) => {
  const { user } = useAuth();
  const params = useMemo(
    () => buildThreadSearchPayload(props, user?.id),
    [props, user?.id],
  );
  const {
    data,
    fetchNextPage,
    isFetchingNextPage,
    hasNextPage,
    isLoading,
    isFetching,
  } = useNormalizedInfiniteQuery(
    { entity: EntityType.THREAD, format: Format.FULL },
    {
      params,
      initialSortState: [
        {
          field: "lastMessageAt",
          sort: "desc",
        },
      ],
    },
  );
  const threads = useMemo<Thread[]>(() => {
    const seen = new Set<string>();
    const threadRows = (data?.pages || []).flat();

    return threadRows.filter((thread) => {
      if (!thread || seen.has(thread.id)) {
        return false;
      }

      seen.add(thread.id);

      return true;
    });
  }, [data]);

  return {
    threads,
    fetchNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
    hasNextPage,
  };
};
