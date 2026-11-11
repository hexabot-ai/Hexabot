/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { UseQueryOptions } from "@tanstack/react-query";
import axios from "axios";
import { stringify } from "qs";
import { useContext, useMemo } from "react";

import { ApiClientContext } from "@/contexts/apiClient.context";
import { useBroadcastChannel } from "@/contexts/broadcast-channel.context";
import { useTranslate } from "@/hooks/useTranslate";
import type { ApiClient, EntityApiClient } from "@/services/api.class";
import { QueryType, TMutationOptions } from "@/services/types";
import { THook } from "@/types/base.types";
import { isLoginPath } from "@/utils/URL";

import { useAuthRedirection } from "./auth/useAuthRedirection";
import { useTanstackMutation, useTanstackQuery } from "./crud/useTanstack";
import { useAppRouter } from "./useAppRouter";
import { useConfig } from "./useConfig";
import { useToast } from "./useToast";

type IsEmptyArray<T> = T extends any[]
  ? T["length"] extends 0
    ? true
    : false
  : false;

const isBlob = (data: unknown): data is Blob => {
  return typeof Blob !== "undefined" && data instanceof Blob;
};

export const normalizeErrorResponseData = async (data: unknown) => {
  if (!isBlob(data)) {
    return data;
  }

  const contentType = data.type.toLowerCase();

  if (
    contentType &&
    !contentType.includes("json") &&
    !contentType.startsWith("text/")
  ) {
    return data;
  }

  const text = await data.text();

  if (!text) {
    return data;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

export const useAxiosInstance = () => {
  const { apiUrl } = useConfig();
  const router = useAppRouter();
  const { logoutRedirection } = useAuthRedirection();
  const { toast } = useToast();
  const { i18n, t } = useTranslate();
  const { postMessage } = useBroadcastChannel();
  const axiosInstance = useMemo(() => {
    const instance = axios.create({
      baseURL: apiUrl,
      withCredentials: true,
    });
    const currentLanguage = i18n.resolvedLanguage || i18n.language;

    if (currentLanguage) {
      instance.defaults.headers.common["Accept-Language"] = currentLanguage;
    }
    // Added the same Query String (de)Serializer as NestJS,

    instance.defaults.paramsSerializer = function (params) {
      // config was made with trial and error and reading the docs
      return stringify(params, {
        arrayFormat: "indices",
        charsetSentinel: false,
        skipNulls: true,
        charset: "utf-8",
      });
    };

    instance.interceptors.request.use((requestConfig) => {
      const activeLanguage = i18n.resolvedLanguage || i18n.language;

      if (activeLanguage) {
        requestConfig.headers = requestConfig.headers || {};
        requestConfig.headers["Accept-Language"] = activeLanguage;
      }

      return requestConfig;
    });

    // Response Interceptor
    instance.interceptors.response.use(
      (resp) => resp,
      async (error) => {
        if (!error.response) {
          // Optionally redirect to an error page or show a notification
          toast.error(t("message.network_error"));

          return Promise.reject(new Error("Network error"));
        }

        if (error.response.status === 401 && !isLoginPath(router.pathname)) {
          await logoutRedirection(router.asPath, true);
          postMessage({ event: "logout" });
        }

        return Promise.reject(
          await normalizeErrorResponseData(error.response.data),
        );
      },
    );

    return instance;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, i18n, logoutRedirection, t, toast]);

  return axiosInstance;
};

const entityApiClients = new Map();

export const getApiClientByEntity = <TE extends THook["entity"]>(
  entity: TE,
  apiClient: ApiClient,
) => {
  if (!entityApiClients.has(entity)) {
    const client = apiClient.buildEntityClient<TE>(entity);

    entityApiClients.set(entity, client);
  }

  return entityApiClients.get(entity) as EntityApiClient<TE>;
};

export const useApiClient = (): ApiClientContext => {
  const context = useContext(ApiClientContext);

  if (!context) {
    throw new Error("useApiClient must be used within an ApiClientContext");
  }

  return context;
};

export const useEntityApiClient = <TE extends THook["entity"]>(entity: TE) => {
  const { getApiClientByEntity } = useApiClient();

  return getApiClientByEntity(entity);
};

export const getApiClientQueryKey = (
  methodName: keyof ApiClient,
  params: readonly unknown[] = [],
) => [QueryType.item, methodName, ...params] as const;

export const useApiClientQuery = <
  N extends keyof ApiClient,
  F extends ApiClient[N],
>(
  methodName: N,
  options: Omit<UseQueryOptions<Awaited<ReturnType<F>>, Error>, "queryKey"> & {
    params?: IsEmptyArray<Parameters<F>> extends true ? [void] : Parameters<F>;
  } = {},
) => {
  const { apiClient } = useApiClient();
  const { params = [], ...rest } = options;

  return useTanstackQuery({
    ...rest,
    queryKey: getApiClientQueryKey(methodName, params),
    queryFn: () => (apiClient[methodName] as Function)(...params),
  });
};

export const useApiClientMutation = <
  N extends keyof ApiClient,
  F extends ApiClient[N],
>(
  methodName: N,
  options?: TMutationOptions<Awaited<ReturnType<F>>, Error, Parameters<F>>,
) => {
  const { apiClient } = useApiClient();

  return useTanstackMutation({
    ...options,
    mutationKey: [QueryType.item, methodName],
    mutationFn: (variables) =>
      (apiClient[methodName] as Function)(...variables),
  });
};
