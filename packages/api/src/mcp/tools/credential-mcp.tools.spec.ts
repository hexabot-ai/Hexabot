/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
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
