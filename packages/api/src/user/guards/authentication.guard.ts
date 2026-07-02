/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';

import { config } from '@/config';

import { API_BEARER_STRATEGY } from '../passport/auth-strategy/api-bearer.strategy';
import {
  extractBearerToken,
  getNormalizedPathname,
} from '../utils/authenticated-user';

/**
 * Front door for authentication. It runs before the {@link Ability}
 * authorization guard and decides *how* the caller is identified:
 *
 * - `Authorization: Bearer hbt_api_…` → delegate to the `api-bearer` passport
 *   strategy, which verifies the token and populates `req.user` / `req.apiToken`
 *   statelessly (no session is created).
 * - Any other `Authorization` header → reject; we never silently fall back to a
 *   session cookie when the caller intended to authenticate with a token.
 * - No `Authorization` header → allow through, relying on the session that
 *   `passport.session()` already restored onto `req.user`.
 *
 * Authorization (roles, token scopes, session expiry) remains entirely in the
 * {@link Ability} guard.
 */
@Injectable()
export class AuthenticationGuard extends AuthGuard(API_BEARER_STRATEGY) {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const pathname = getNormalizedPathname(request);

    // MCP endpoints authenticate with their own token scheme (`hbt_mcp_…`) via
    // HexabotMcpTokenGuard, so this guard must not try to consume their bearer.
    if (config.mcp.enabled && pathname === '/mcp') {
      return true;
    }

    const bearerToken = extractBearerToken(request);

    if (bearerToken) {
      if (this.isApiTokenExcludedPath(pathname)) {
        throw new UnauthorizedException(
          'API tokens cannot be used on this endpoint',
        );
      }

      return (await super.canActivate(context)) as boolean;
    }

    if (typeof request.headers.authorization === 'string') {
      throw new UnauthorizedException('Invalid API bearer token');
    }

    return true;
  }

  private isApiTokenExcludedPath(pathname?: string): boolean {
    if (!pathname) {
      return true;
    }

    return (
      pathname.startsWith('/auth') ||
      pathname === '/logout' ||
      pathname.startsWith('/api-token') ||
      pathname.startsWith('/mcp-token') ||
      pathname.startsWith('/webhook') ||
      pathname === '/csrftoken' ||
      pathname === '/__getcookie' ||
      pathname === '/config'
    );
  }
}
