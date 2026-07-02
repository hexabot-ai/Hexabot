/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { csrfSync } from 'csrf-sync';
import { Request } from 'express';

import { config } from '.';

const hasApiBearerToken = (req: Request): boolean =>
  typeof req.headers.authorization === 'string' &&
  /^Bearer\s+hbt_api_\S+$/i.test(req.headers.authorization.trim());

export const csrf = csrfSync({
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getTokenFromRequest: (req: Request) =>
    (req.headers['x-csrf-token'] as string) ??
    (req.body?._csrf as string) ??
    (req.query?._csrf as string) ??
    undefined,
  skipCsrfProtection: (req) => {
    const path = req.path.replace(`/api`, '');

    return (
      hasApiBearerToken(req) ||
      config.security.csrfExclude.some((re) => re.test(path))
    );
  },
});
