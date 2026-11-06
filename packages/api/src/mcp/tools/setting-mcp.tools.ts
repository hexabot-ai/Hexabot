/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action, type Setting, settingValueSchema } from '@hexabot-ai/types';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Tool, ToolGuards } from '@rekog/mcp-nest';
import { z } from 'zod';

import { SettingService } from '@/setting/services/setting.service';

import { McpPermission } from '../decorators/mcp-permission.decorator';
import { McpPermissionGuard } from '../guards/mcp-permission.guard';

import { HexabotMcpToolBase } from './hexabot-mcp-tool.base';
import { getReadableKeys, hasSecretValue } from './hexabot-mcp.utils';

@Injectable()
export class HexabotSettingMcpTools extends HexabotMcpToolBase {
  constructor(private readonly settingService: SettingService) {
    super();
  }

  @McpPermission('setting', Action.READ)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_setting_search',
    description:
      'List runtime settings with their current values, optionally for one group (global_settings, or the group of an action or helper, named after it). Secret settings (password fields, and settings no registered schema declares, e.g. those of a removed extension) are listed with secret=true and hasValue instead of their value.',
    parameters: z.object({
      group: z.string().min(1).optional(),
    }),
  })
  async searchSettings(args: { group?: string }) {
    const settings = await this.settingService.find({
      where: args.group ? { group: args.group } : {},
      order: { group: 'ASC', label: 'ASC' },
    });
    const schemas = this.settingService.getAllSchemaDefinitions();
    const items = settings.map((setting) =>
      this.withoutSecretValue(
        setting,
        getReadableKeys(schemas[setting.group]?.schema),
      ),
    );

    return { items, total: items.length };
  }

  @McpPermission('setting', Action.READ)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_setting_schema_get',
    description:
      'Read the JSON Schema of one runtime setting group: its labels, value types, defaults and allowed values.',
    parameters: z.object({
      group: z.string().min(1),
    }),
  })
  async getSettingSchema(args: { group: string }) {
    const schemas = this.settingService.getAllSchemaDefinitions();
    const definition = schemas[args.group];
    if (!definition) {
      throw new NotFoundException(
        `Setting group "${args.group}" is not registered. Registered groups: ${Object.keys(schemas).sort().join(', ')}`,
      );
    }

    return { group: args.group, ...definition };
  }

  @McpPermission('setting', Action.UPDATE)
  @ToolGuards([McpPermissionGuard])
  @Tool({
    name: 'hexabot_setting_update',
    description:
      'Set the value of one runtime setting, addressed by group and label. The value is validated against the setting schema (hexabot_setting_schema_get). A secret setting is returned without its value.',
    parameters: z.object({
      group: z.string().min(1),
      label: z.string().min(1),
      value: settingValueSchema,
    }),
  })
  async updateSetting(args: {
    group: string;
    label: string;
    value: Setting['value'];
  }) {
    const setting = await this.settingService.findOne({
      where: { group: args.group, label: args.label },
    });
    if (!setting) {
      throw new NotFoundException(
        `Setting "${args.group}.${args.label}" not found`,
      );
    }

    const updated = await this.settingService.updateOne(setting.id, {
      value: args.value,
    });
    const schemas = this.settingService.getAllSchemaDefinitions();

    return this.withoutSecretValue(
      updated,
      getReadableKeys(schemas[updated.group]?.schema),
    );
  }

  /**
   * Replace the value of a setting its group's schema does not declare as
   * readable (`getReadableKeys`) with whether it has one.
   */
  private withoutSecretValue(setting: Setting, readableLabels: Set<string>) {
    if (readableLabels.has(setting.label)) {
      return setting;
    }

    const { value, ...rest } = setting;

    return { ...rest, secret: true, hasValue: hasSecretValue(value) };
  }
}
