/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  CONTENT_FIELD_TYPES,
  DEFAULT_CONTENT_TYPE_SCHEMA,
} from '@hexabot-ai/types';
import { MCP_TOOL_METADATA_KEY } from '@rekog/mcp-nest';
import { z } from 'zod';

import { HexabotCmsMcpTools } from './cms-mcp.tools';

const getToolParameters = (method: keyof HexabotCmsMcpTools) =>
  Reflect.getMetadata(
    MCP_TOOL_METADATA_KEY,
    HexabotCmsMcpTools.prototype[method],
  ).parameters as z.ZodObject;
const schemaWithField = (field: Record<string, unknown>) => ({
  ...DEFAULT_CONTENT_TYPE_SCHEMA,
  properties: { ...DEFAULT_CONTENT_TYPE_SCHEMA.properties, link: field },
});

describe('HexabotCmsMcpTools', () => {
  it.each(['createContentType', 'updateContentType'] as const)(
    '%s only takes Hexabot field types',
    (method) => {
      const parameters = getToolParameters(method);
      const args = {
        id: '9b2b7a52-4d35-4c43-9a8f-0c0b9c0f5a10',
        name: 'Article',
      };

      expect(
        parameters.safeParse({
          ...args,
          schema: schemaWithField({ type: 'uri', title: 'Link' }),
        }).success,
      ).toBe(true);

      const formatted = parameters.safeParse({
        ...args,
        schema: schemaWithField({ type: 'string', format: 'uri' }),
      });

      expect(formatted.success).toBe(false);
      expect(formatted.error?.issues[0]?.path).toEqual([
        'schema',
        'properties',
        'link',
      ]);
      expect(formatted.error?.issues[0]?.message).toContain('{"type":"uri"}');
    },
  );

  it('documents content type and content fields in the tool input schemas', () => {
    const contentTypeInput = z.toJSONSchema(
      getToolParameters('createContentType'),
      { io: 'input' },
    ) as any;
    const contentInput = z.toJSONSchema(getToolParameters('createContent'), {
      io: 'input',
    }) as any;

    expect(
      contentTypeInput.properties.schema.properties.properties
        .additionalProperties.properties.type.enum,
    ).toEqual([...CONTENT_FIELD_TYPES]);
    expect(contentInput.properties.properties.description).toContain(
      'for file fields',
    );
  });
});
