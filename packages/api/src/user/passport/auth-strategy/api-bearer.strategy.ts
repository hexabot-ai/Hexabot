/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { User } from '@hexabot-ai/types';
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-http-bearer';

import { ApiTokenService } from '../../services/api-token.service';
import { ApiTokenAuthenticatedRequest } from '../../types/api-token.type';

export const API_BEARER_STRATEGY = 'api-bearer';

/**
 * Authenticates personal API tokens (`hbt_api_…`) presented as
 * `Authorization: Bearer <token>`. It is stateless: no session is created
 * (see `defaultOptions.session === false` in `@nestjs/passport`), the token is
 * verified on every request and the resulting user is attached to `req.user`
 * for that request only. Token metadata (id + scopes) is exposed on
 * `req.apiToken` for the authorization layer.
 */
@Injectable()
export class ApiBearerStrategy extends PassportStrategy(
  Strategy,
  API_BEARER_STRATEGY,
) {
  constructor(private readonly apiTokenService: ApiTokenService) {
    super({ passReqToCallback: true });
  }

  async validate(
    req: ApiTokenAuthenticatedRequest,
    token: string,
  ): Promise<User> {
    const { user, tokenId, scopes } =
      await this.apiTokenService.authenticateApiBearerToken(token);

    req.apiToken = { id: tokenId, scopes };

    return user;
  }
}
