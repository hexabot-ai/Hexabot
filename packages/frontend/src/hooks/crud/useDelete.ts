/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { TMutationOptions } from "@/services/types";
import { THook } from "@/types/base.types";

import { useEntityApiClient } from "../useApiClient";

import { useTanstackMutation } from "./useTanstack";

export const useDelete = <
  TE extends THook["entity"],
  TBasic = THook<{ entity: TE }>["basic"],
>(
  entity: TE,
  options?: TMutationOptions<string, Error, string, TBasic>,
) => {
  const api = useEntityApiClient(entity);
  const { routeParams, ...otherOptions } = options || {};

  return useTanstackMutation({
    mutationFn: async (id) => {
      const result = await api.delete(id, routeParams);

      return result;
    },
    ...otherOptions,
  });
};
