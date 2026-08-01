/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { JSONSchema7 as JsonSchema } from 'json-schema';
import { z } from 'zod';

import type { I18nService } from '@/i18n/services/i18n.service';

export type JsonSchemaLocalizationOptions = {
  i18n: Pick<I18nService, 't'>;
  ns: string;
  lang?: string;
};

type ToDraft07JsonSchemaOptions = {
  localize?: JsonSchemaLocalizationOptions;
};
const localizeSchemaNodeMetadata = (
  schemaNode: Record<string, unknown>,
  options: JsonSchemaLocalizationOptions,
) => {
  const { i18n, ns, lang } = options;
  const toLocalizedString = (value: string) => {
    return i18n.t(value, {
      ns,
      ...(lang ? { lang } : {}),
      defaultValue: value,
    });
  };

  if (typeof schemaNode.title === 'string') {
    schemaNode.title = toLocalizedString(schemaNode.title);
  }

  if (typeof schemaNode.description === 'string') {
    schemaNode.description = toLocalizedString(schemaNode.description);
  }
};

/**
 * Convert a Zod schema to a Draft-07 JSON schema.
 */
export const toDraft07JsonSchema = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  options?: ToDraft07JsonSchemaOptions,
): JsonSchema => {
  const localize = options?.localize;
  const jsonSchema = schema.toJSONSchema({
    target: 'draft-07',
    ...(localize
      ? {
          override: ({ jsonSchema }) => {
            localizeSchemaNodeMetadata(
              jsonSchema as Record<string, unknown>,
              localize,
            );
          },
        }
      : {}),
  }) as JsonSchema;

  return jsonSchema;
};
