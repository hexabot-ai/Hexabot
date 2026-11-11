/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { config } from '@/config';

import { TRole } from '../entities/role.entity';
import { PermissionService } from '../services/permission.service';
import { Action } from '../types/action.type';
import { PermissionsTree } from '../types/permission.type';

import { Ability } from './ability.guard';

const user = { id: 'user-1', roles: ['role-editor'] };
const permissions = {
  'role-editor': { workflow: [Action.READ, Action.UPDATE] },
  'role-other': { workflow: [Action.CREATE, Action.DELETE] },
} as unknown as PermissionsTree;
const activeCookie = { expires: new Date(Date.now() + 60_000) };

describe('Ability', () => {
  const mcpEnabled = config.mcp.enabled;
  let reflector: { get: jest.Mock };
  let permissionService: { getPermissions: jest.Mock };
  let guard: Ability;

  const canActivate = ({
    pathname,
    roles,
    method = 'GET',
    requestUser = user,
    cookie = activeCookie,
  }: {
    pathname: string;
    roles?: TRole[];
    method?: string;
    requestUser?: Record<string, unknown> | null;
    cookie?: Record<string, unknown> | null;
  }) => {
    reflector.get.mockReturnValue(roles);
    const request = {
      _parsedUrl: { pathname },
      method,
      user: requestUser ?? undefined,
      session: { cookie: cookie ?? undefined },
    };

    return guard.canActivate({
      getHandler: () => canActivate,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext);
  };

  beforeEach(() => {
    config.mcp.enabled = false;
    reflector = { get: jest.fn() };
    permissionService = {
      getPermissions: jest.fn().mockResolvedValue(permissions),
    };
    guard = new Ability(
      reflector as unknown as Reflector,
      permissionService as unknown as PermissionService,
    );
  });

  afterAll(() => {
    config.mcp.enabled = mcpEnabled;
  });

  it('reads the roles of the handler', async () => {
    await canActivate({ pathname: '/api/workflow' });

    expect(reflector.get).toHaveBeenCalledWith('roles', canActivate);
  });

  describe('public access', () => {
    it('lets anyone call the MCP endpoint when MCP is enabled', async () => {
      config.mcp.enabled = true;

      await expect(
        canActivate({ pathname: '/api/mcp', requestUser: null }),
      ).resolves.toBe(true);
    });

    it('requires a user on the MCP endpoint when MCP is disabled', async () => {
      await expect(
        canActivate({ pathname: '/api/mcp', requestUser: null }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('lets anyone call a public route', async () => {
      await expect(
        canActivate({
          pathname: '/api/auth/local',
          roles: ['public'],
          requestUser: null,
          cookie: null,
        }),
      ).resolves.toBe(true);
    });
  });

  describe('authentication', () => {
    it('refuses a request without user', async () => {
      await expect(
        canActivate({ pathname: '/api/workflow', requestUser: null }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it.each([
      ['without cookie', null],
      ['with an expired cookie', { expires: new Date(Date.now() - 1) }],
    ])('refuses a session %s', async (_case, cookie) => {
      await expect(
        canActivate({ pathname: '/api/workflow', cookie }),
      ).rejects.toThrow(new UnauthorizedException('Session expired'));
    });

    it('accepts a session cookie without expiry', async () => {
      await expect(
        canActivate({ pathname: '/api/workflow', cookie: {} }),
      ).resolves.toBe(true);
    });
  });

  describe('authenticated access', () => {
    it('lets any user manage their MCP tokens when MCP is enabled', async () => {
      config.mcp.enabled = true;

      await expect(
        canActivate({
          pathname: '/api/mcp-token/token-1',
          requestUser: { id: 'user-2', roles: [] },
        }),
      ).resolves.toBe(true);
    });

    it('refuses everything else to a user without role', async () => {
      await expect(
        canActivate({
          pathname: '/api/mcp-token',
          requestUser: { id: 'user-2', roles: [] },
        }),
      ).resolves.toBe(false);
      await expect(
        canActivate({
          pathname: '/api/auth/me',
          requestUser: { id: 'user-2' },
        }),
      ).resolves.toBe(false);
      expect(permissionService.getPermissions).not.toHaveBeenCalled();
    });

    it.each([
      '/api/auth/logout',
      '/api/logout',
      '/api/auth/me',
      '/api/channel',
      '/api/action',
      `/api/user/edit/${user.id}`,
      `/api/user/${user.id}/profile_pic`,
    ])('lets a user with a role call %s', async (pathname) => {
      await expect(
        canActivate({ pathname, requestUser: { ...user, roles: ['none'] } }),
      ).resolves.toBe(true);
      expect(permissionService.getPermissions).not.toHaveBeenCalled();
    });

    it('checks the permissions for the profile of another user', async () => {
      await expect(
        canActivate({ pathname: '/api/user/edit/user-2', method: 'POST' }),
      ).resolves.toBe(false);
      expect(permissionService.getPermissions).toHaveBeenCalled();
    });
  });

  describe('permissions', () => {
    it('allows the action the HTTP method maps to on the model of the path', async () => {
      await expect(
        canActivate({ pathname: '/api/workflow/workflow-1', method: 'GET' }),
      ).resolves.toBe(true);
      await expect(
        canActivate({ pathname: '/api/Workflow', method: 'PATCH' }),
      ).resolves.toBe(true);
      await expect(
        canActivate({ pathname: '/workflow', method: 'GET' }),
      ).resolves.toBe(true);
    });

    it('refuses an action none of the roles of the user allows', async () => {
      await expect(
        canActivate({ pathname: '/api/workflow', method: 'POST' }),
      ).resolves.toBe(false);
      await expect(
        canActivate({ pathname: '/api/content', method: 'GET' }),
      ).resolves.toBe(false);
    });

    it('combines the permissions of every role of the user', async () => {
      await expect(
        canActivate({
          pathname: '/api/workflow',
          method: 'DELETE',
          requestUser: { ...user, roles: ['role-editor', 'role-other'] },
        }),
      ).resolves.toBe(true);
    });

    it('fails when the permissions cannot be loaded', async () => {
      permissionService.getPermissions.mockResolvedValue(undefined);

      await expect(canActivate({ pathname: '/api/workflow' })).rejects.toThrow(
        new NotFoundException('Failed to load permissions'),
      );
    });
  });
});
