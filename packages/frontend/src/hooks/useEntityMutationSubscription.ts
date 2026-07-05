/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { normalize, schema as normalizrSchema } from "normalizr";
import { useCallback } from "react";

import { isSameEntity } from "@/hooks/crud/helpers";
import { useTanstackQueryClient } from "@/hooks/crud/useTanstack";
import {
  mergeEntityCachePayload,
  type CacheRecord,
} from "@/hooks/entity-cache.utils";
import { ENTITY_MAP } from "@/services/entities";
import { EntityType, QueryType } from "@/services/types";
import { IBaseSchema } from "@/types/base.types";
import { InfiniteData, QueryClient } from "@/types/tanstack.types";
import { applyFullNameDerivedFields } from "@/utils/full-name.utils";
import { useSocketGetQuery, useSubscribe } from "@/websocket/socket-hooks";

export const SYNC_TARGET_BY_ENTITY_TYPE = {
  [EntityType.USER]: EntityType.SUBSCRIBER,
} as const;
export const PAYLOAD_TRANSFORMERS_BY_ENTITY_TYPE = {
  [EntityType.USER]: applyFullNameDerivedFields,
  [EntityType.SUBSCRIBER]: applyFullNameDerivedFields,
} as const;

const getAffectedEntityTypes = (entityType: EntityType): EntityType[] => {
  const syncTarget = SYNC_TARGET_BY_ENTITY_TYPE[entityType];

  return syncTarget ? [entityType, syncTarget] : [entityType];
};
const transformEntityPayload = (entityType: EntityType, payload: unknown) =>
  PAYLOAD_TRANSFORMERS_BY_ENTITY_TYPE[entityType]?.(payload) ?? payload;

export { mergeEntityCachePayload } from "@/hooks/entity-cache.utils";

type EntityMutationEvent<E extends IBaseSchema = IBaseSchema> = {
  entity: string;
  op: "create" | "update" | "delete";
  data: E;
};

// Builds a stable lookup key from websocket entity names.
const normalizeEntityKey = (entity: string) => {
  return entity.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
};
// Precomputes websocket entity aliases to frontend EntityType values.
const ENTITY_TYPE_BY_WS_KEY = (() => {
  const entityMap: Record<string, EntityType> = {};

  Object.values(EntityType).forEach((entityType) => {
    entityMap[normalizeEntityKey(entityType)] = entityType;

    const [baseEntity] = entityType.split("/");
    const normalizedBaseEntity = normalizeEntityKey(baseEntity);

    if (!entityMap[normalizedBaseEntity]) {
      entityMap[normalizedBaseEntity] = entityType;
    }
  });

  return entityMap;
})();
// Resolves an incoming websocket entity name to a known EntityType.
const resolveEntityType = (entity: unknown): EntityType | null => {
  if (typeof entity !== "string") {
    return null;
  }

  return ENTITY_TYPE_BY_WS_KEY[normalizeEntityKey(entity)] ?? null;
};

type QueryParams = {
  where?: Record<string, unknown>;
};
// Matches count/collection queries for the targeted entity.
export const isCountOrCollectionQuery = (
  queryKey: readonly unknown[],
  entity: EntityType,
) => {
  const [qType, qEntity] = queryKey;

  return (
    (qType === QueryType.count || qType === QueryType.collection) &&
    isSameEntity(qEntity, entity)
  );
};
// Safely parses serialized query params from TanStack query keys.
const parseQueryParams = (queryParams: unknown): QueryParams => {
  if (typeof queryParams !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(queryParams);

    return typeof parsed === "object" && parsed !== null
      ? (parsed as QueryParams)
      : {};
  } catch {
    return {};
  }
};
// Creates a cache updater that prepends a new id to the first infinite page.
const prependInfiniteFirstPage = (result: unknown) => (oldData: unknown) => {
  if (!oldData) {
    return oldData;
  }

  const data = oldData as InfiniteData<string[]>;
  const [firstPage = [], ...remainingPages] = data.pages;

  return {
    ...data,
    pages: [[result, ...firstPage], ...remainingPages],
  };
};
// Extracts a thread id from a message payload.
const getMessageThreadId = (data: IBaseSchema) => {
  const payload = data as unknown as { thread?: unknown };
  // Supports both plain string refs and normalized object refs with `id`.
  const getId = (value: unknown) => {
    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "object" && value !== null && "id" in value) {
      const maybeId = (value as { id?: unknown }).id;

      return typeof maybeId === "string" ? maybeId : "";
    }

    return "";
  };

  return getId(payload.thread);
};

export const isThreadInfiniteQuery = (queryKey: readonly unknown[]) => {
  const [qType, qEntity] = queryKey;

  return (
    qType === QueryType.infinite && isSameEntity(qEntity, EntityType.THREAD)
  );
};
// Detects relation refs in a payload that are missing from the item cache.
export const hasMissingRelationRef = (
  queryClient: QueryClient,
  entityType: EntityType,
  entityData: CacheRecord,
) => {
  // normalizr typings omit the runtime `schema` getter
  const relationSchemas: Record<string, unknown> =
    (ENTITY_MAP[entityType] as unknown as { schema?: Record<string, unknown> })
      .schema ?? {};

  return Object.entries(relationSchemas).some(([relation, relationSchema]) => {
    const relationId = entityData[relation];

    return (
      typeof relationId === "string" &&
      relationSchema instanceof normalizrSchema.Entity &&
      !queryClient.getQueryData([
        QueryType.item,
        relationSchema.key,
        relationId,
      ])
    );
  });
};

export const useEntityMutationSubscription = () => {
  const queryClient = useTanstackQueryClient();

  useSocketGetQuery("/entity/subscribe/");

  const handleEntityMutation = useCallback(
    ({ entity: eventEntityName, op, data }: EntityMutationEvent) => {
      const entityType = resolveEntityType(eventEntityName);

      if (!entityType || !(entityType in ENTITY_MAP)) {
        return;
      }

      const affectedEntityTypes = getAffectedEntityTypes(entityType);

      if (op === "delete") {
        const id = data.id;

        if (!id) {
          return;
        }

        queryClient.removeQueries({
          queryKey: [QueryType.item, entityType, id],
          exact: true,
        });

        queryClient.refetchQueries({
          predicate: ({ queryKey }) =>
            isCountOrCollectionQuery(queryKey, entityType),
        });

        return;
      }

      const entitySchema = ENTITY_MAP[entityType];
      const { result, entities } = normalize(
        data,
        Array.isArray(data) ? [entitySchema] : entitySchema,
      );

      Object.entries(entities).forEach(([, entitiesById]) => {
        if (!entitiesById) {
          return;
        }

        Object.entries(entitiesById).forEach(([id, nextEntityData]) => {
          if (!id || !nextEntityData) {
            return;
          }

          affectedEntityTypes.forEach((affectedEntityType) => {
            if (
              hasMissingRelationRef(
                queryClient,
                affectedEntityType,
                nextEntityData as CacheRecord,
              )
            ) {
              // Skip the merge: it would mark the query fresh and cancel
              // this invalidation for observers that mount later.
              queryClient.invalidateQueries({
                queryKey: [QueryType.item, affectedEntityType, id],
                exact: true,
              });

              return;
            }

            queryClient.setQueryData(
              [QueryType.item, affectedEntityType, id],
              (previousData: CacheRecord | undefined) => {
                return transformEntityPayload(
                  affectedEntityType,
                  mergeEntityCachePayload(
                    affectedEntityType,
                    previousData,
                    nextEntityData as CacheRecord,
                  ),
                );
              },
            );
          });
        });
      });

      if (op === "create") {
        queryClient.refetchQueries({
          predicate: ({ queryKey }) =>
            isCountOrCollectionQuery(queryKey, entityType),
        });
        const updateInfiniteQuery = (
          predicate: (queryKey: readonly unknown[]) => boolean,
        ) => {
          queryClient.setQueriesData(
            {
              predicate: ({ queryKey }) => predicate(queryKey),
            },
            prependInfiniteFirstPage(result),
          );
        };

        if (entityType === EntityType.SUBSCRIBER) {
          updateInfiniteQuery((queryKey) => {
            const [qType, qEntity, qParams] = queryKey;

            if (
              qType !== QueryType.infinite ||
              !isSameEntity(qEntity, EntityType.SUBSCRIBER)
            ) {
              return false;
            }

            const params = parseQueryParams(qParams);
            const channelFilter = params.where?.["channel.name"] as
              | { $in?: unknown[] }
              | undefined;

            return !params.where || channelFilter?.["$in"]?.length === 0;
          });
        } else if (entityType === EntityType.MESSAGE) {
          const threadId = getMessageThreadId(data);

          if (threadId) {
            updateInfiniteQuery((queryKey) => {
              const [qType, qEntity, qParams] = queryKey;

              if (
                qType !== QueryType.infinite ||
                !isSameEntity(qEntity, EntityType.MESSAGE)
              ) {
                return false;
              }

              const params = parseQueryParams(qParams);
              const threadFilter = params.where?.["thread.id"];

              return threadFilter === threadId;
            });
          }
        } else if (entityType === EntityType.THREAD) {
          queryClient.refetchQueries({
            predicate: ({ queryKey }) => isThreadInfiniteQuery(queryKey),
          });
        }
      } else {
        affectedEntityTypes.forEach((affectedEntityType) => {
          if (
            "label" in data &&
            data.label === "license_key" &&
            affectedEntityType === EntityType.SETTING
          ) {
            queryClient.invalidateQueries({
              queryKey: [QueryType.item, "getCurrentSession"],
            });
          }

          queryClient.setQueriesData(
            {
              predicate({ queryKey }) {
                const [qType, qEntity] = queryKey;

                return (
                  (qType === QueryType.collection ||
                    qType === QueryType.infinite) &&
                  isSameEntity(qEntity, affectedEntityType)
                );
              },
            },
            (collection: unknown) => {
              return Array.isArray(collection)
                ? [...collection]
                : structuredClone(collection);
            },
          );
        });
      }
    },
    [queryClient],
  );

  useSubscribe<EntityMutationEvent>("entity", handleEntityMutation);
};
