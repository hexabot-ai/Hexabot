/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action, ApiTokenType } from '@hexabot-ai/types';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { ApiTokenRepository } from '../repositories/api-token.repository';

import {
  API_PERSONAL_TOKEN_PREFIX,
  ApiTokenService,
} from './api-token.service';
import { PermissionService } from './permission.service';
import { UserService } from './user.service';

describe('ApiTokenService', () => {
  const user = {
    id: 'user-id',
    username: 'agent',
    email: 'agent@example.com',
    roles: ['role-id'],
    state: true,
  };
  const buildService = (overrides: Partial<ApiTokenRepository> = {}) => {
    const repository = {
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      findOneByHash: jest.fn(),
      touchLastUsedAt: jest.fn(),
      updateOne: jest.fn(),
      ...overrides,
    } as unknown as jest.Mocked<ApiTokenRepository>;
    const userService = {
      findOne: jest.fn().mockResolvedValue(user),
    } as unknown as jest.Mocked<UserService>;
    const permissionService = {
      getPermissions: jest.fn().mockResolvedValue({
        'role-id': {
          workflow: [Action.READ, Action.CREATE],
        },
      }),
    } as unknown as jest.Mocked<PermissionService>;

    return {
      permissionService,
      repository,
      service: new ApiTokenService(repository, userService, permissionService),
      userService,
    };
  };

  it('creates an API token and stores only a hash', async () => {
    const { repository, service } = buildService({
      create: jest.fn().mockImplementation((payload) => ({
        id: 'token-id',
        name: payload.name,
        tokenPrefix: payload.tokenPrefix,
        tokenType: payload.tokenType,
        scopes: payload.scopes,
        owner: payload.owner,
        expiresAt: payload.expiresAt,
        lastUsedAt: null,
        revokedAt: null,
      })),
    });
    const result = await service.createApiToken('user-id', {
      name: 'Automation',
      scopes: [{ model: 'workflow', action: Action.READ }],
    });

    expect(result.token).toMatch(new RegExp(`^${API_PERSONAL_TOKEN_PREFIX}`));
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Automation',
        owner: 'user-id',
        tokenHash: expect.any(String),
        tokenPrefix: expect.stringMatching(/^hbt_api_/),
        tokenType: ApiTokenType.API,
        scopes: [{ model: 'workflow', action: Action.READ }],
      }),
    );
    expect(repository.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ token: result.token }),
    );
    expect(JSON.stringify(result.record)).not.toContain('tokenHash');
  });

  it('rejects scopes the owner cannot grant', async () => {
    const { service } = buildService();

    await expect(
      service.createApiToken('user-id', {
        name: 'Automation',
        scopes: [{ model: 'user', action: Action.DELETE }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('authenticates an active API token owner with scopes', async () => {
    const owner = {
      state: true,
      toPlainCls: jest.fn().mockReturnValue(user),
    };
    const { repository, service } = buildService({
      findOneByHash: jest.fn().mockResolvedValue({
        id: 'token-id',
        owner,
        scopes: [{ model: 'workflow', action: Action.READ }],
        expiresAt: null,
        revokedAt: null,
      } as any),
      touchLastUsedAt: jest.fn().mockResolvedValue(undefined),
    });

    await expect(
      service.authenticateApiBearerToken(`${API_PERSONAL_TOKEN_PREFIX}secret`),
    ).resolves.toEqual({
      user,
      tokenId: 'token-id',
      scopes: [{ model: 'workflow', action: Action.READ }],
    });

    expect(repository.touchLastUsedAt).toHaveBeenCalledWith('token-id');
  });

  it('rejects invalid, revoked, expired, or inactive tokens', async () => {
    const { repository, service } = buildService();

    await expect(
      service.authenticateApiBearerToken('not-a-hexabot-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    repository.findOneByHash.mockResolvedValueOnce(null);
    await expect(
      service.authenticateApiBearerToken(`${API_PERSONAL_TOKEN_PREFIX}unknown`),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    repository.findOneByHash.mockResolvedValueOnce({
      revokedAt: new Date(),
    } as any);
    await expect(
      service.authenticateApiBearerToken(`${API_PERSONAL_TOKEN_PREFIX}revoked`),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    repository.findOneByHash.mockResolvedValueOnce({
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    } as any);
    await expect(
      service.authenticateApiBearerToken(`${API_PERSONAL_TOKEN_PREFIX}expired`),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    repository.findOneByHash.mockResolvedValueOnce({
      revokedAt: null,
      expiresAt: null,
      owner: { state: false },
    } as any);
    await expect(
      service.authenticateApiBearerToken(
        `${API_PERSONAL_TOKEN_PREFIX}inactive`,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
