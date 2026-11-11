/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type {
  DefaultError,
  InfiniteData,
  QueryClient,
  QueryKey,
  QueryOptions,
  UseQueryOptions as TanstackUseQueryOptions,
  UseInfiniteQueryOptions,
  UseMutationOptions,
} from "@tanstack/react-query";

import type { RouteParams } from "@/services/api.class";

interface UseQueryOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> extends TanstackUseQueryOptions<TQueryFnData, TError, TData, TQueryKey> {
  routeParams?: RouteParams;
  onError?: (err: DefaultError | null) => void;
  onSuccess?: (data: TQueryFnData) => void;
}

export type {
  DefaultError,
  InfiniteData,
  QueryClient,
  QueryKey,
  QueryOptions,
  UseInfiniteQueryOptions,
  UseMutationOptions,
  UseQueryOptions,
};
