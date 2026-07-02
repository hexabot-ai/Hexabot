/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { User } from '@hexabot-ai/types';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { config } from '@/config';

import { TRole } from '../entities/role.entity';
import { ApiTokenService } from '../services/api-token.service';
import { PermissionService } from '../services/permission.service';
import { MethodToAction } from '../types/action.type';
import { ApiTokenAuthenticatedRequest } from '../types/api-token.type';
import { TModel } from '../types/model.type';
import { getNormalizedPathname } from '../utils/authenticated-user';

@Injectable()
export class Ability implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly permissionService: PermissionService,
    private readonly apiTokenService: ApiTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.get<TRole[]>('roles', context.getHandler());
    // Authentication (session or API bearer token) already ran in
    // AuthenticationGuard, which populated `req.user` and, for token callers,
    // `req.apiToken`. This guard is only concerned with authorization.
    const request = context
      .switchToHttp()
      .getRequest<ApiTokenAuthenticatedRequest & { user: User }>();
    const pathname = getNormalizedPathname(request);

    if (config.mcp.enabled && pathname && pathname === '/mcp') {
      return true;
    }

    if (roles?.includes('public')) {
      return true;
    }

    const { user, method, session, apiToken } = request;
    if (!user) {
      throw new UnauthorizedException();
    }
    if (
      !apiToken &&
      (!session?.cookie ||
        (session.cookie?.expires && session.cookie.expires < new Date()))
    ) {
      throw new UnauthorizedException('Session expired');
    }

    if (config.mcp.enabled && pathname?.startsWith('/mcp-token')) {
      return true;
    }
    if (pathname?.startsWith('/api-token')) {
      return true;
    }

    const roleIds = Array.isArray(user.roles) ? user.roles : [];

    if (roleIds.length) {
      // These convenience routes are granted to any authenticated *session*
      // user regardless of model permissions. They are intentionally gated on
      // `!apiToken`: personal API tokens get no such blanket access and must
      // instead carry an explicit (model, action) permission + scope below. A
      // consequence is that routes whose first path segment is not a model
      // identity (e.g. `/channel`, `/action`, workflow transfer) are
      // unreachable by token callers by design.
      if (
        !apiToken &&
        pathname &&
        [
          // Allow access to all routes available for authenticated users
          '/auth/logout',
          '/logout',
          '/auth/me',
          '/channel',
          '/action',
          // Allow to update own profile
          `/user/edit/${user.id}`,
          // Allow access to own avatar
          `/user/${user.id}/profile_pic`,
        ].includes(pathname)
      ) {
        return true;
      }
      const modelFromPathname = pathname?.split('/')[1].toLowerCase() as
        | TModel
        | undefined;
      const permissions = await this.permissionService.getPermissions();
      const requiredAction = MethodToAction[method];

      if (permissions) {
        const permissionsFromRoles = Object.entries(permissions)
          .filter(([key, _]) => roleIds.includes(key))
          .map(([_, value]) => value);

        if (
          modelFromPathname &&
          requiredAction &&
          permissionsFromRoles.some((permission) =>
            permission[modelFromPathname]?.includes(requiredAction),
          )
        ) {
          if (apiToken) {
            const hasTokenScope = await this.apiTokenService.hasTokenScope(
              apiToken,
              modelFromPathname,
              requiredAction,
            );

            if (!hasTokenScope) {
              throw new ForbiddenException(
                `API token requires ${requiredAction} scope on ${modelFromPathname}`,
              );
            }
          }

          return true;
        }
      } else {
        throw new NotFoundException('Failed to load permissions');
      }
    }

    return false;
  }
}
