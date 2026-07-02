/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { ApiTokenScope, User } from '@hexabot-ai/types';
import type { Request } from 'express';

export type ApiTokenAuthContext = {
  id: string;
  scopes: ApiTokenScope[];
};

export type ApiTokenAuthenticatedRequest = Request & {
  user?: User;
  apiToken?: ApiTokenAuthContext;
};
