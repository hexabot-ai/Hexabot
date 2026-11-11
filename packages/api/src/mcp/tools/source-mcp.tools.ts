/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from '@hexabot-ai/types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { I18nContext } from 'nestjs-i18n';
import { z } from 'zod';

import { ChannelService } from '@/channel/channel.service';
import { SourceOrmEntity } from '@/channel/entities/source.entity';
import { SourceService } from '@/channel/services/source.service';
import { I18nService } from '@/i18n/services/i18n.service';
import { toDraft07JsonSchema } from '@/utils/helpers/zod';

import { McpPermission } from '../decorators/mcp-permission.decorator';

import { HexabotMcpToolBase } from './hexabot-mcp-tool.base';
import {
  jsonObjectSchema,
  PaginationArgs,
  paginationSchema,
  uuidSchema,
} from './hexabot-mcp.schemas';
import { getReadableKeys, hasSecretValue } from './hexabot-mcp.utils';

type SourceLike = { channel: string; settings: Record<string, unknown> };

@Injectable()
export class HexabotSourceMcpTools extends HexabotMcpToolBase {
  constructor(
    private readonly sourceService: SourceService,
    private readonly channelService: ChannelService,
    private readonly i18nService: I18nService,
  ) {
    super();
  }

  @McpPermission('source', Action.READ)
  @Tool({
    name: 'hexabot_channel_search',
    description:
      'List the registered messaging channels with the JSON Schema of the settings a source of each channel takes.',
    parameters: z.object({}),
  })
  async searchChannels() {
    const items = this.channelService.getAll().map((handler) => ({
      name: handler.getName(),
      visibility: handler.getVisibility(),
      settingsSchema: this.getSettingsSchema(handler.getName()),
    }));

    return { items, total: items.length };
  }

  @McpPermission('source', Action.READ)
  @Tool({
    name: 'hexabot_source_search',
    description:
      'Search channel sources: the instances of a channel that receive messages, each with its settings and the workflow that handles them (defaultWorkflow). Secret settings (password fields, and every setting of a source whose channel is no longer registered) are named in secretSettings instead of returned.',
    parameters: z.object({
      query: z.string().optional(),
      channel: z.string().optional(),
      state: z.boolean().optional(),
      defaultWorkflowId: uuidSchema.optional(),
      ...paginationSchema,
    }),
  })
  async searchSources(
    args: {
      query?: string;
      channel?: string;
      state?: boolean;
      defaultWorkflowId?: string;
    } & PaginationArgs,
  ) {
    const where = {
      ...(args.query ? { name: this.contains(args.query) } : {}),
      ...(args.channel ? { channel: args.channel } : {}),
      ...(args.state !== undefined ? { state: args.state } : {}),
      ...(args.defaultWorkflowId
        ? { defaultWorkflow: { id: args.defaultWorkflowId } }
        : {}),
    };
    const result = await this.listWithCount(
      this.sourceService,
      this.findOptions<SourceOrmEntity>(args, where),
    );

    return {
      ...result,
      items: (result.items as SourceLike[]).map((source) =>
        this.withoutSecretSettings(source),
      ),
    };
  }

  @McpPermission('source', Action.READ)
  @Tool({
    name: 'hexabot_source_get',
    description:
      'Read one channel source. Secret settings (password fields, and every setting of a source whose channel is no longer registered) are named in secretSettings instead of returned.',
    parameters: z.object({
      id: uuidSchema,
    }),
  })
  async getSource(args: { id: string }) {
    const source = await this.sourceService.findOneAndPopulate(args.id);
    if (!source) {
      throw new NotFoundException(`Source ${args.id} not found`);
    }

    return this.withoutSecretSettings(source);
  }

  @McpPermission('source', Action.CREATE)
  @Tool({
    name: 'hexabot_source_create',
    description:
      'Create a source of a registered channel (hexabot_channel_search), with its settings and, optionally, the workflow that handles its messages.',
    parameters: z.object({
      name: z.string().min(1),
      channel: z.string().min(1),
      settings: jsonObjectSchema.optional(),
      state: z.boolean().optional(),
      defaultWorkflow: uuidSchema.nullable().optional(),
    }),
  })
  async createSource(args: {
    name: string;
    channel: string;
    settings?: Record<string, unknown>;
    state?: boolean;
    defaultWorkflow?: string | null;
  }) {
    await this.assertNameAvailable(args.name);
    const source = await this.sourceService.create(args);

    return this.withoutSecretSettings(source);
  }

  @McpPermission('source', Action.UPDATE)
  @Tool({
    name: 'hexabot_source_update',
    description:
      'Update a channel source: its name, state, the workflow that handles its messages (defaultWorkflow, null to clear it), or some of its settings. The settings passed are merged into the current ones, so secret settings left out keep their value.',
    parameters: z.object({
      id: uuidSchema,
      name: z.string().min(1).optional(),
      settings: jsonObjectSchema.optional(),
      state: z.boolean().optional(),
      defaultWorkflow: uuidSchema.nullable().optional(),
    }),
  })
  async updateSource(args: {
    id: string;
    name?: string;
    settings?: Record<string, unknown>;
    state?: boolean;
    defaultWorkflow?: string | null;
  }) {
    const { id, settings, ...updates } = args;
    if (Object.keys(updates).length === 0 && settings === undefined) {
      throw new BadRequestException(
        'Provide a name, settings, state or defaultWorkflow to update',
      );
    }

    const source = await this.sourceService.findOne(id);
    if (!source) {
      throw new NotFoundException(`Source ${id} not found`);
    }
    if (updates.name !== undefined && updates.name !== source.name) {
      await this.assertNameAvailable(updates.name);
    }

    const updated = await this.sourceService.updateOne(id, {
      ...updates,
      ...(settings !== undefined
        ? { settings: { ...source.settings, ...settings } }
        : {}),
    });

    return this.withoutSecretSettings(updated);
  }

  private getSettingsSchema(channel: string) {
    const handler = this.channelService.findChannel(channel);

    return handler
      ? toDraft07JsonSchema(
          handler.getSourceSettingsSchema(),
          this.i18nService.getJsonSchemaLocalizationOptions(
            channel,
            I18nContext.current()?.lang,
          ),
        )
      : undefined;
  }

  /**
   * Keep only the settings of a source its channel's settings schema declares
   * as readable (`getReadableKeys`), and name the others that have a value in
   * `secretSettings`. A source whose channel is no longer registered (its
   * extension was removed; the source is only disabled) keeps its settings,
   * secrets included, but has no schema: all of them are withheld.
   */
  private withoutSecretSettings<T extends SourceLike>(source: T) {
    let schema: ReturnType<typeof this.getSettingsSchema>;
    try {
      schema = this.getSettingsSchema(source.channel);
    } catch {
      schema = undefined;
    }
    const readableKeys = getReadableKeys(
      schema as { properties?: Record<string, unknown> } | undefined,
    );
    const entries = Object.entries(source.settings ?? {});
    const settings = Object.fromEntries(
      entries.filter(([key]) => readableKeys.has(key)),
    );
    const secretSettings = entries
      .filter(([key, value]) => !readableKeys.has(key) && hasSecretValue(value))
      .map(([key]) => key);

    return { ...source, settings, secretSettings };
  }

  /**
   * Refuse a name another source has, with a message the client can act on
   * instead of the database's unique constraint error.
   */
  private async assertNameAvailable(name: string) {
    if (await this.sourceService.findOne({ where: { name } })) {
      throw new ConflictException(`A source named "${name}" already exists`);
    }
  }
}
