/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { UnauthorizedException } from '@nestjs/common';

import { ApiTokenService } from '@/user/services/api-token.service';

import {
  MCP_PERSONAL_TOKEN_PREFIX,
  McpTokenService,
} from './mcp-token.service';

describe('McpTokenService', () => {
  const user = {
    id: 'user-id',
    username: 'agent',
    email: 'agent@example.com',
    roles: ['role-id'],
    state: true,
  };
  const buildService = (overrides: Partial<ApiTokenService> = {}) => {
    const apiTokenService = {
      authenticateMcpBearerToken: jest.fn(),
      createMcpToken: jest.fn(),
      findOwnedMcpTokens: jest.fn(),
      revokeOwnedMcpToken: jest.fn(),
      ...overrides,
    } as unknown as jest.Mocked<ApiTokenService>;

    return {
      apiTokenService,
      service: new McpTokenService(apiTokenService),
    };
  };

  it('creates MCP tokens through the shared token service', async () => {
    const { apiTokenService, service } = buildService({
      createMcpToken: jest.fn().mockResolvedValue({
        token: `${MCP_PERSONAL_TOKEN_PREFIX}secret`,
        record: {
          id: 'token-id',
          name: 'Codex',
          tokenPrefix: `${MCP_PERSONAL_TOKEN_PREFIX}abcd`,
          owner: 'user-id',
          expiresAt: null,
          lastUsedAt: null,
          revokedAt: null,
        },
      }),
    });
    const result = await service.createPersonalToken('user-id', {
      name: 'Codex',
    });

    expect(result.token).toMatch(new RegExp(`^${MCP_PERSONAL_TOKEN_PREFIX}`));
    expect(apiTokenService.createMcpToken).toHaveBeenCalledWith(
      'user-id',
      expect.objectContaining({ name: 'Codex' }),
    );
  });

  it('authenticates an active token owner', async () => {
    const { apiTokenService, service } = buildService({
      authenticateMcpBearerToken: jest.fn().mockResolvedValue({
        user,
        tokenId: 'token-id',
      }),
    });

    await expect(
      service.authenticateBearerToken(`${MCP_PERSONAL_TOKEN_PREFIX}secret`),
    ).resolves.toEqual({ user, tokenId: 'token-id' });

    expect(apiTokenService.authenticateMcpBearerToken).toHaveBeenCalledWith(
      `${MCP_PERSONAL_TOKEN_PREFIX}secret`,
    );
  });

  it('rejects revoked, expired, unknown, or inactive tokens', async () => {
    const { service } = buildService({
      authenticateMcpBearerToken: jest
        .fn()
        .mockRejectedValue(new UnauthorizedException()),
    });

    await expect(
      service.authenticateBearerToken(`${MCP_PERSONAL_TOKEN_PREFIX}inactive`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
