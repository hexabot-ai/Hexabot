/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Progress } from "@/app-components/displays/Progress";
import { runtimeConfig } from "@/config/runtime";
import { AuthContext } from "@/contexts/auth.context";
import { useBroadcastChannel } from "@/contexts/broadcast-channel.context";
import { useAuthRedirection } from "@/hooks/auth/useAuthRedirection";
import { useGet } from "@/hooks/crud/useGet";
import { useTanstackQueryClient } from "@/hooks/crud/useTanstack";
import { useApiClientMutation, useApiClientQuery } from "@/hooks/useApiClient";
import { useAppRouter } from "@/hooks/useAppRouter";
import { useConfig } from "@/hooks/useConfig";
import { useI18n } from "@/hooks/useI18n";
import { useSubscribeBroadcastChannel } from "@/hooks/useSubscribeBroadcastChannel";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType, QueryType } from "@/services/types";
import { User } from "@/types/user.types";
import { useSocket } from "@/websocket/socket-hooks";

export interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps): ReactElement => {
  const router = useAppRouter();
  const { hasUserSession } = useConfig();
  const [isAuthenticated, setIsAuthenticated] = useState(hasUserSession);
  const { updateI18nLanguage } = useI18n();
  const { t } = useTranslate();
  const { logoutRedirection, loginRedirection } = useAuthRedirection();
  const { postMessage } = useBroadcastChannel();
  const { socket } = useSocket();
  const { toast } = useToast();
  const queryClient = useTanstackQueryClient();
  const postLogin = async (data: User) => {
    if (data.state) {
      setIsAuthenticated(true);
      queryClient.setQueryData([QueryType.item, "getCurrentSession"], data);
      await loginRedirection();
      postMessage({ event: "login" });
      toast.success(t("message.login_success"));
    } else {
      toast.error(t("message.account_disabled"));
    }
  };
  const loginMutation = useApiClientMutation("login", {
    async onSuccess(data) {
      await postLogin(data);
    },
    onError() {
      toast.error(t("message.login_failure"));
    },
  });
  const preLogout = useCallback(async () => {
    socket?.disconnect();
    setIsAuthenticated(false);
    await updateI18nLanguage(runtimeConfig.lang.default);
  }, [updateI18nLanguage, socket]);
  const postLogout = useCallback(async () => {
    queryClient.clear();
    await logoutRedirection(router.asPath);
    postMessage({ event: "logout" });
  }, [logoutRedirection, postMessage, queryClient, router.asPath]);
  const logoutMutation = useApiClientMutation("logout", {
    async onMutate() {
      await preLogout();
    },
    async onSuccess() {
      await postLogout();
      toast.success(t("message.logout_success"));
    },
    onError: () => {
      toast.error(t("message.logout_failed"));
    },
  });
  const {
    data: me,
    error,
    isLoading,
    refetch,
  } = useApiClientQuery("getCurrentSession");
  const { data: user } = useGet(
    me?.id || "",
    { entity: EntityType.USER },
    {
      enabled: !!me?.id,
      onSuccess(data) {
        setIsAuthenticated(!!data);
        queryClient.setQueryData(
          [QueryType.item, EntityType.SUBSCRIBER, data?.id],
          data,
        );
      },
    },
  );
  const userWithLicense = useMemo(
    () => ({ ...user, license: me?.license }) as typeof me,
    [me, user],
  );

  useEffect(() => {
    if (user?.language) {
      void updateI18nLanguage(user.language);
    }
  }, [updateI18nLanguage, user?.language]);
  const refetchUser = useCallback(async () => {
    const { data } = await refetch();

    return data;
  }, [refetch]);

  useSubscribeBroadcastChannel("login", () => {
    if (!isAuthenticated) {
      router.reload();
    }
  });

  useSubscribeBroadcastChannel("logout", () => {
    if (isAuthenticated) {
      router.reload();
    }
  });

  if (isLoading || !userWithLicense) {
    return <Progress />;
  }

  return (
    <AuthContext.Provider
      value={{
        user: userWithLicense,
        isAuthenticated,
        error,
        refetchUser,
        loginMutation,
        logoutMutation,
        setIsAuthenticated,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
