/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { BadRequestException } from '@nestjs/common';

import { findAllForExport } from './workflow-transfer.types';

describe('findAllForExport', () => {
  it('does not look anything up when no resource is referenced', async () => {
    const findByIds = jest.fn();

    await expect(findAllForExport('label', [], findByIds)).resolves.toEqual([]);
    expect(findByIds).not.toHaveBeenCalled();
  });

  it('looks each referenced resource up once', async () => {
    const labels = [{ id: 'a' }, { id: 'b' }];
    const findByIds = jest.fn().mockResolvedValue(labels);

    await expect(
      findAllForExport('label', ['a', 'b', 'a'], findByIds),
    ).resolves.toBe(labels);
    expect(findByIds).toHaveBeenCalledWith(['a', 'b']);
  });

  it('refuses to export when a referenced resource no longer exists', async () => {
    const findByIds = jest.fn().mockResolvedValue([{ id: 'b' }]);
    const result = findAllForExport('MCP server', ['a', 'b', 'c'], findByIds);

    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toThrow(
      'Unable to export workflow: missing MCP server(s): a, c',
    );
  });
});
