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
import { z } from 'zod';

import { HexabotSourceMcpTools } from './source-mcp.tools';

const settingsSchema = z.object({
  bot_token: z.string().default('').meta({
    title: 'Bot token',
    'ui:widget': 'password',
  }),
  greeting: z.string().default('Hi!'),
});
const handler = {
  getName: () => 'telegram',
  getVisibility: () => 'public',
  getSourceSettingsSchema: () => settingsSchema,
};
const source = {
  id: 'source-id',
  name: 'Support bot',
  channel: 'telegram',
  state: true,
  settings: { bot_token: 'secret-bot-token', greeting: 'Hi!' },
  defaultWorkflow: null,
};
const buildTools = (sourceService: Record<string, unknown>) =>
  new HexabotSourceMcpTools(
    sourceService as any,
    {
      getAll: () => [handler],
      findChannel: (name: string) =>
        name === handler.getName() ? handler : undefined,
    } as any,
    { getJsonSchemaLocalizationOptions: () => ({}) } as any,
  );

describe('HexabotSourceMcpTools', () => {
  it('lists the registered channels with their source settings schema', async () => {
    const result = await buildTools({}).searchChannels();

    expect(result).toEqual({
      items: [
        {
          name: 'telegram',
          visibility: 'public',
          settingsSchema: expect.objectContaining({
            properties: expect.objectContaining({
              bot_token: expect.objectContaining({ 'ui:widget': 'password' }),
            }),
          }),
        },
      ],
      total: 1,
    });
  });

  it('reads a source without the values of its secret settings', async () => {
    const tools = buildTools({
      findOneAndPopulate: jest.fn().mockResolvedValue(source),
    });
    const result = await tools.getSource({ id: 'source-id' });

    expect(result).toEqual({
      ...source,
      settings: { greeting: 'Hi!' },
      secretSettings: ['bot_token'],
    });
    expect(JSON.stringify(result)).not.toContain('secret-bot-token');
  });

  it('withholds every setting of a source whose channel is no longer registered', async () => {
    // Removing a channel extension only disables its sources: their settings,
    // secrets included, stay stored, but no schema says which are secrets.
    const orphan = {
      ...source,
      id: 'orphan-id',
      channel: 'messenger',
      state: false,
      settings: { page_token: 'secret-page-token', greeting: 'Hi!', empty: '' },
    };
    const tools = buildTools({
      findOneAndPopulate: jest.fn().mockResolvedValue(orphan),
    });
    const result = await tools.getSource({ id: 'orphan-id' });

    expect(result).toEqual({
      ...orphan,
      settings: {},
      secretSettings: ['page_token', 'greeting'],
    });
    expect(JSON.stringify(result)).not.toContain('secret-page-token');
  });

  it('withholds the settings its channel schema does not declare', async () => {
    const tools = buildTools({
      findOneAndPopulate: jest.fn().mockResolvedValue({
        ...source,
        settings: { ...source.settings, legacy_secret: 'old-secret' },
      }),
    });
    const result = await tools.getSource({ id: 'source-id' });

    expect(result.settings).toEqual({ greeting: 'Hi!' });
    expect(result.secretSettings).toEqual(['bot_token', 'legacy_secret']);
    expect(JSON.stringify(result)).not.toContain('old-secret');
  });

  it('withholds every setting when its channel schema cannot be built', async () => {
    const tools = new HexabotSourceMcpTools(
      {
        findOneAndPopulate: jest.fn().mockResolvedValue(source),
      } as any,
      {
        findChannel: () => ({
          ...handler,
          getSourceSettingsSchema: () => {
            throw new Error('Unrepresentable schema');
          },
        }),
      } as any,
      { getJsonSchemaLocalizationOptions: () => ({}) } as any,
    );
    const result = await tools.getSource({ id: 'source-id' });

    expect(result.settings).toEqual({});
    expect(result.secretSettings).toEqual(['bot_token', 'greeting']);
  });

  it('searches sources without the values of their secret settings', async () => {
    const sourceService = {
      findAndPopulate: jest.fn().mockResolvedValue([source]),
      count: jest.fn().mockResolvedValue(1),
    };
    const tools = buildTools(sourceService);
    const result = await tools.searchSources({
      channel: 'telegram',
      state: true,
      limit: 20,
      skip: 0,
      sortBy: 'createdAt',
      sortDirection: 'DESC',
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        settings: { greeting: 'Hi!' },
        secretSettings: ['bot_token'],
      }),
    ]);
    expect(sourceService.findAndPopulate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channel: 'telegram', state: true },
      }),
    );
  });

  it('sets the workflow of a source and merges the settings passed into its current ones', async () => {
    const sourceService = {
      findOne: jest.fn().mockResolvedValue(source),
      updateOne: jest.fn().mockResolvedValue({
        ...source,
        settings: { ...source.settings, greeting: 'Hello!' },
        defaultWorkflow: 'workflow-id',
      }),
    };
    const tools = buildTools(sourceService);
    const result = await tools.updateSource({
      id: 'source-id',
      settings: { greeting: 'Hello!' },
      defaultWorkflow: 'workflow-id',
    });

    expect(sourceService.updateOne).toHaveBeenCalledWith('source-id', {
      settings: { bot_token: 'secret-bot-token', greeting: 'Hello!' },
      defaultWorkflow: 'workflow-id',
    });
    expect(result).toEqual(
      expect.objectContaining({
        settings: { greeting: 'Hello!' },
        secretSettings: ['bot_token'],
        defaultWorkflow: 'workflow-id',
      }),
    );
  });

  it('refuses an empty update, an unknown source and a taken name', async () => {
    const sourceService = {
      findOne: jest
        .fn()
        .mockImplementation((idOrOptions: unknown) =>
          Promise.resolve(
            idOrOptions === 'missing-id'
              ? null
              : typeof idOrOptions === 'string'
                ? source
                : { ...source, id: 'other-id', name: 'Sales bot' },
          ),
        ),
      updateOne: jest.fn(),
    };
    const tools = buildTools(sourceService);

    await expect(
      tools.updateSource({ id: 'source-id' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      tools.updateSource({ id: 'missing-id', state: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      tools.updateSource({ id: 'source-id', name: 'Sales bot' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(sourceService.updateOne).not.toHaveBeenCalled();
  });

  it('creates a source, refusing a name another source has', async () => {
    const sourceService = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(source),
      create: jest.fn().mockResolvedValue(source),
    };
    const tools = buildTools(sourceService);
    const payload = {
      name: 'Support bot',
      channel: 'telegram',
      settings: { bot_token: 'secret-bot-token' },
    };

    await expect(tools.createSource(payload)).resolves.toEqual(
      expect.objectContaining({ secretSettings: ['bot_token'] }),
    );
    expect(sourceService.create).toHaveBeenCalledWith(payload);
    await expect(tools.createSource(payload)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(sourceService.create).toHaveBeenCalledTimes(1);
  });
});
