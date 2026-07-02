/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Url } from 'url';

import { Action } from '@hexabot-ai/types';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ApiTokenService } from '../services/api-token.service';
import { PermissionService } from '../services/permission.service';

import { Ability } from './ability.guard';

const buildContext = (request: Record<string, unknown>): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => () => undefined,
  }) as unknown as ExecutionContext;

describe('Ability authorization', () => {
  const user = {
    id: 'user-id',
    roles: ['role-id'],
    state: true,
  };
  const buildGuard = (
    apiTokenServiceOverrides: Partial<ApiTokenService> = {},
  ) => {
    const permissionService = {
      getPermissions: jest.fn().mockResolvedValue({
        'role-id': {
          workflow: [Action.READ],
        },
      }),
    } as unknown as jest.Mocked<PermissionService>;
    const apiTokenService = {
      hasTokenScope: jest.fn().mockResolvedValue(true),
      ...apiTokenServiceOverrides,
    } as unknown as jest.Mocked<ApiTokenService>;

    return {
      apiTokenService,
      guard: new Ability(new Reflector(), permissionService, apiTokenService),
      permissionService,
    };
  };
  // Requests reach Ability already authenticated by AuthenticationGuard: a
  // token caller carries `apiToken`/`user`, a session caller carries `session`.
  const buildTokenRequest = (overrides: Record<string, unknown> = {}) => ({
    _parsedUrl: { pathname: '/api/workflow' } as Url,
    method: 'GET',
    user,
    apiToken: {
      id: 'token-id',
      scopes: [{ model: 'workflow', action: Action.READ }],
    },
    ...overrides,
  });
  const buildSessionRequest = (overrides: Record<string, unknown> = {}) => ({
    _parsedUrl: { pathname: '/api/workflow' } as Url,
    method: 'GET',
    user,
    session: { cookie: {} },
    ...overrides,
  });

  it('authorizes an API token that holds the required scope', async () => {
    const { apiTokenService, guard } = buildGuard();

    await expect(
      guard.canActivate(buildContext(buildTokenRequest())),
    ).resolves.toBe(true);

    expect(apiTokenService.hasTokenScope).toHaveBeenCalledWith(
      { id: 'token-id', scopes: [{ model: 'workflow', action: Action.READ }] },
      'workflow',
      Action.READ,
    );
  });

  it('rejects API tokens missing the required scope', async () => {
    const { guard } = buildGuard({
      hasTokenScope: jest.fn().mockResolvedValue(false),
    });

    await expect(
      guard.canActivate(buildContext(buildTokenRequest())),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('authorizes a session user through role permissions', async () => {
    const { apiTokenService, guard } = buildGuard();

    await expect(
      guard.canActivate(buildContext(buildSessionRequest())),
    ).resolves.toBe(true);

    // Session callers are not subject to token-scope checks.
    expect(apiTokenService.hasTokenScope).not.toHaveBeenCalled();
  });

  it('rejects a request without an authenticated user', async () => {
    const { guard } = buildGuard();

    await expect(
      guard.canActivate(buildContext(buildSessionRequest({ user: undefined }))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a session whose cookie has expired', async () => {
    const { guard } = buildGuard();

    await expect(
      guard.canActivate(
        buildContext(
          buildSessionRequest({
            session: { cookie: { expires: new Date(Date.now() - 1000) } },
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
