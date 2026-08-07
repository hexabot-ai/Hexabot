/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { matchPath } from "react-router";

import { RouterType } from "@/services/types";

export const buildURL = (baseUrl: string, relativePath: string): string => {
  try {
    return new URL(relativePath).toString();
  } catch {
    try {
      return new URL(
        relativePath.replace(/^\//, ""),
        baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
      ).toString();
    } catch {
      throw new Error(`Invalid base URL: ${baseUrl}`);
    }
  }
};

type AbsoluteUrlOptions = {
  requireTld?: boolean;
};

export const isAbsoluteUrl = (
  value: string = "",
  options: AbsoluteUrlOptions = {},
): boolean => {
  const { requireTld = false } = options;

  try {
    const url = new URL(value);
    const hasValidProtocol =
      url.protocol === "http:" || url.protocol === "https:";
    const hasMatchingProtocolPrefix =
      (url.href.startsWith("http://") && value.startsWith("http://")) ||
      (url.href.startsWith("https://") && value.startsWith("https://"));

    if (!hasValidProtocol || !hasMatchingProtocolPrefix) {
      return false;
    }

    if (!requireTld) {
      return Boolean(url.hostname);
    }

    const hostnameParts = url.hostname.split(".");

    return (
      hostnameParts.length > 1 &&
      hostnameParts[hostnameParts.length - 1].length > 1
    );
  } catch (_error) {
    return false;
  }
};

const normalizePath = (pathname: string) => {
  if (!pathname) {
    return "/";
  }

  const normalized =
    pathname.endsWith("/") && pathname !== "/"
      ? pathname.slice(0, -1)
      : pathname;

  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

export const isLoginPath = (pathname: string) => {
  return matchPath(
    { path: normalizePath(`/${RouterType.LOGIN}`), end: false },
    normalizePath(pathname),
  )
    ? true
    : false;
};

const PUBLIC_PATHS = ["/login", "/login/:token", "/reset", "/reset/:token"];

export const hasPublicPath = (pathname: string) => {
  const normalizedPath = normalizePath(pathname);

  return PUBLIC_PATHS.some((path) =>
    matchPath({ path: normalizePath(path), end: false }, normalizedPath),
  );
};
