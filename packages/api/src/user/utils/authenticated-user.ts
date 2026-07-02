/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Url } from 'url';

import type { User } from '@hexabot-ai/types';
import { UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

/**
 * Resolves the request pathname with the global `/api` prefix stripped.
 *
 * Prefers Express's parsed URL (`_parsedUrl`) but falls back to `req.path`, so
 * guards never depend on that internal field being populated: an absent
 * `_parsedUrl` would otherwise yield an `undefined` pathname and, in the
 * authentication guard, reject every bearer request.
 */
export const getNormalizedPathname = (
  req: Request & { _parsedUrl?: Url },
): string | undefined => {
  const pathname = req._parsedUrl?.pathname ?? req.path;

  return pathname?.replace(`/api`, '');
};

export const getAuthenticatedUserId = (req: Request): string | undefined => {
  const user = req.user as (User & { id?: string }) | undefined;

  return user?.id ?? req.session?.passport?.user?.id;
};

export const requireAuthenticatedUserId = (
  req: Request,
  message = 'Authenticated user is required',
): string => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    throw new UnauthorizedException(message);
  }

  return userId;
};

export const getSessionUserId = (req: Request): string | undefined =>
  req.session?.passport?.user?.id;

/**
 * Extracts the credential from an `Authorization: Bearer <token>` header.
 * Returns `undefined` when the header is missing or not a well-formed bearer.
 */
export const extractBearerToken = (req: Request): string | undefined => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return undefined;
  }

  const match = authHeader.trim().match(/^Bearer\s+(\S+)$/i);

  return match?.[1];
};

export const requireSessionUserId = (
  req: Request,
  message = 'Authenticated session is required',
): string => {
  const userId = getSessionUserId(req);
  if (!userId) {
    throw new UnauthorizedException(message);
  }

  return userId;
};
