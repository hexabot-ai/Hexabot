/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import type { HexabotMcpRequest } from '../types';

import { HexabotCredentialMcpTools } from './credential-mcp.tools';
import {
  getReadableKeys,
  omitKeysDeep,
  sanitizeCredential,
  toUserRef,
} from './hexabot-mcp.utils';

const owner = {
  id: 'user-id',
  firstName: 'Ada',
  lastName: 'Lovelace',
  username: 'ada',
  email: 'ada@example.com',
  roles: ['role-id'],
  resetCount: 1,
  resetToken: '$2a$10$pendingPasswordResetTokenHash',
  provider: { strategy: 'local' as const },
};

describe('sanitizeCredential', () => {
  it('masks credential values from MCP output', () => {
    const credential = sanitizeCredential({
      id: 'credential-id',
      name: 'openai',
      value: 'secret-token',
      owner: 'user-id',
    });

    expect(credential).not.toHaveProperty('value');
    expect(JSON.stringify(credential)).not.toContain('secret-token');
  });

  it('reduces a populated credential owner to its id and name', () => {
    const credential = sanitizeCredential({
      id: 'credential-id',
      name: 'openai',
      value: 'secret-token',
      owner,
    });

    expect(credential).toEqual({
      id: 'credential-id',
      name: 'openai',
      owner: { id: 'user-id', firstName: 'Ada', lastName: 'Lovelace' },
    });
  });

  it('omits selected keys recursively from MCP output', () => {
    const output = omitKeysDeep(
      {
        id: 'run-id',
        workflowVersion: {
          id: 'version-id',
          definitionYml: 'large-yaml',
        },
        children: [{ definitionYml: 'child-yaml', status: 'finished' }],
      },
      ['definitionYml'],
    );

    expect(output).toEqual({
      id: 'run-id',
      workflowVersion: {
        id: 'version-id',
      },
      children: [{ status: 'finished' }],
    });
  });
});

describe('toUserRef', () => {
  it('reduces a populated user to its id and name', () => {
    expect(toUserRef(owner)).toEqual({
      id: 'user-id',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
  });

  it('returns ids and missing relations as they are', () => {
    expect(toUserRef('user-id')).toBe('user-id');
    expect(toUserRef(null)).toBeNull();
    expect(toUserRef(undefined)).toBeUndefined();
  });
});

describe('getReadableKeys', () => {
  it('lists the declared properties not rendered as password fields', () => {
    expect(
      getReadableKeys({
        properties: {
          license_key: { type: 'string', 'ui:widget': 'password' },
          default_rag_helper: { type: 'string' },
        },
      }),
    ).toEqual(new Set(['default_rag_helper']));
  });

  it('lists nothing without a schema or declared properties', () => {
    expect(getReadableKeys(undefined)).toEqual(new Set());
    expect(getReadableKeys({})).toEqual(new Set());
  });
});

describe('HexabotCredentialMcpTools', () => {
  const request = { hexabotUser: owner } as unknown as HexabotMcpRequest;
  const stored = {
    id: 'credential-id',
    name: 'openai',
    value: 'secret-token',
    owner: 'user-id',
  };
  const buildTools = (credentialService: Record<string, unknown>) =>
    new HexabotCredentialMcpTools(credentialService as any);

  it('creates a credential owned by the MCP user without returning its value', async () => {
    const credentialService = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(stored),
    };
    const tools = buildTools(credentialService);

    await expect(
      tools.createCredential(
        { name: 'openai', value: 'secret-token' },
        {},
        request,
      ),
    ).resolves.toEqual({
      id: 'credential-id',
      name: 'openai',
      owner: 'user-id',
    });
    expect(credentialService.create).toHaveBeenCalledWith({
      name: 'openai',
      value: 'secret-token',
      owner: 'user-id',
    });
  });

  it('refuses a credential name another credential has', async () => {
    const credentialService = {
      findOne: jest.fn().mockResolvedValue(stored),
      create: jest.fn(),
    };
    const tools = buildTools(credentialService);

    await expect(
      tools.createCredential({ name: 'openai', value: 'other' }, {}, request),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(credentialService.findOne).toHaveBeenCalledWith({
      where: { name: 'openai' },
    });
    expect(credentialService.create).not.toHaveBeenCalled();
  });

  it('replaces a credential value without returning it', async () => {
    const credentialService = {
      findOne: jest.fn().mockResolvedValue(stored),
      updateOne: jest.fn().mockResolvedValue({ ...stored, value: 'rotated' }),
    };
    const tools = buildTools(credentialService);
    const result = await tools.updateCredential({
      id: 'credential-id',
      value: 'rotated',
    });

    expect(result).not.toHaveProperty('value');
    expect(JSON.stringify(result)).not.toContain('rotated');
    expect(credentialService.updateOne).toHaveBeenCalledWith('credential-id', {
      value: 'rotated',
    });
  });

  it('refuses an empty update, an unknown credential and a taken name', async () => {
    const credentialService = {
      findOne: jest
        .fn()
        .mockImplementation((idOrOptions: unknown) =>
          Promise.resolve(
            idOrOptions === 'missing-id'
              ? null
              : typeof idOrOptions === 'string'
                ? stored
                : { ...stored, id: 'other-id', name: 'anthropic' },
          ),
        ),
      updateOne: jest.fn(),
    };
    const tools = buildTools(credentialService);

    await expect(
      tools.updateCredential({ id: 'credential-id' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      tools.updateCredential({ id: 'missing-id', value: 'rotated' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      tools.updateCredential({ id: 'credential-id', name: 'anthropic' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(credentialService.updateOne).not.toHaveBeenCalled();
  });
});
