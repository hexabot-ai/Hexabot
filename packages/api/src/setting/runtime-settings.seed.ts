/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { SettingCreateDto } from '@/setting/dto/setting.dto';
import { RuntimeSettingGroupSchema } from '@/setting/runtime-settings';
import { RuntimeSettingRegistryMap } from '@/setting/services/runtime-settings.service';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};
const resolveGroupDefaultValues = (
  schema: RuntimeSettingGroupSchema,
  context: string,
): Record<string, unknown> => {
  const parsed = schema.safeParse({});

  if (!parsed.success || parsed.data === undefined) {
    throw new Error(
      `Setting group "${context}" must define default values in its zod schema.`,
    );
  }

  if (!isPlainObject(parsed.data)) {
    throw new Error(
      `Setting group "${context}" default values must resolve to an object.`,
    );
  }

  const expectedKeys = schema.keyof().options;
  const missingDefaultKeys = expectedKeys.filter(
    (key) => !(key in parsed.data),
  );

  if (missingDefaultKeys.length > 0) {
    throw new Error(
      `Setting group "${context}" is missing default values for: ${missingDefaultKeys.join(', ')}.`,
    );
  }

  return parsed.data;
};

type BuildSettingSeedsFromSchemaOptions = {
  subgroup?: 'helper';
};

export const buildSettingSeedsFromSchema = (
  group: string,
  schema: RuntimeSettingGroupSchema,
  options?: BuildSettingSeedsFromSchemaOptions,
): SettingCreateDto[] => {
  const defaults = resolveGroupDefaultValues(schema, group);

  return Object.entries(defaults).map(([label, value]) => {
    if (value === undefined) {
      throw new Error(
        `Setting "${group}.${label}" must define a default value in its zod schema.`,
      );
    }

    return {
      group,
      ...(options?.subgroup ? { subgroup: options.subgroup } : {}),
      label,
      value,
    };
  });
};

export const buildSettingSeedsFromRegistry = (
  registry: RuntimeSettingRegistryMap,
): SettingCreateDto[] => {
  return Object.entries(registry).flatMap(([group, definition]) => {
    const subgroup =
      definition.scope === 'extension' && definition.extensionType === 'helper'
        ? definition.extensionType
        : undefined;

    return buildSettingSeedsFromSchema(
      group,
      definition.schema as RuntimeSettingGroupSchema,
      subgroup ? { subgroup } : undefined,
    );
  });
};
