/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { RouterType } from "@/services/types";
import { hasPublicPath, isLoginPath } from "@/utils/URL";

import { useAppRouter } from "../useAppRouter";

const REDIRECTION_QUERY_PARAM_NAME = "next" as const;

export const useAuthRedirection = () => {
  const router = useAppRouter();
  const logoutRedirection = async (
    pathname: string,
    fullReload: boolean = false,
  ) => {
    if (!hasPublicPath(pathname) && !isLoginPath(router.pathname)) {
      const redirectUrl = `/${RouterType.LOGIN}?${REDIRECTION_QUERY_PARAM_NAME}=${encodeURIComponent(
        pathname,
      )}`;

      if (fullReload) {
        return window.location.replace(redirectUrl);
      } else {
        return await router.replace(redirectUrl);
      }
    }
  };
  const loginRedirection = async () => {
    const nextValue = router.query[REDIRECTION_QUERY_PARAM_NAME];

    if (isLoginPath(router.pathname) && nextValue) {
      const redirectUrl = Array.isArray(nextValue)
        ? nextValue.at(-1)
        : nextValue;

      if (redirectUrl?.startsWith("/") && !hasPublicPath(redirectUrl)) {
        return await router.push(redirectUrl);
      }
    } else if (router.pathname !== RouterType.HOME) {
      return await router.push(RouterType.HOME);
    }
  };

  return { logoutRedirection, loginRedirection };
};
