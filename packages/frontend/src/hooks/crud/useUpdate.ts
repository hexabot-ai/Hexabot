/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { TMutationOptions } from "@/services/types";
import { THook } from "@/types/base.types";

import { useEntityApiClient } from "../useApiClient";

import { useNormalizeAndCache } from "./helpers";
import { useTanstackMutation } from "./useTanstack";

export const useUpdate = <
  TE extends THook["entity"],
  TAttr extends THook["attributes"] = THook<{ entity: TE }>["attributes"],
  TBasic extends THook["basic"] = THook<{ entity: TE }>["basic"],
>(
  entity: TE,
  options?: TMutationOptions<
    TBasic,
    Error,
    { id: string; params: Partial<TAttr> },
    TBasic
  >,
) => {
  const api = useEntityApiClient(entity);
  const normalizeAndCache = useNormalizeAndCache<string>(entity);
  const { routeParams, ...otherOptions } = options || {};

  return useTanstackMutation({
    mutationFn: async ({ id, params }) => {
      const data = await api.update(id, params, routeParams);
      const { entities, result } = normalizeAndCache(data);

      return entities[entity]?.[result] as TBasic;
    },
    ...otherOptions,
  });
};
