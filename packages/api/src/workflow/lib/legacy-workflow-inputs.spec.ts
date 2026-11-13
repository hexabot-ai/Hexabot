/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { validateWorkflow } from '@hexabot-ai/agentic';
import { parse } from 'yaml';

import {
  extractWorkflowInputs,
  upgradeLegacyWorkflowInputs,
} from './legacy-workflow-inputs';

const FLOW = `defs:
  greet:
    kind: task
    action: noop
flow:
  # Greets the caller.
  - do: greet
outputs: {}
`;
const withInputs = (inputs: string) => `${inputs}${FLOW}`;
const FIELD_MAP = withInputs(`inputs:
  schema:
    question:
      type: string
      description: What to answer
    pages:
      type: integer
    tags:
      type: array
      items:
        type: string
        enum: [a, b]
    filters:
      type: object
      properties:
        lang:
          type: string
    extra:
      type: object
`);
const inputsOf = (definitionYml: string) =>
  (parse(definitionYml) as { inputs?: unknown }).inputs;

describe('upgradeLegacyWorkflowInputs', () => {
  it('turns the field map of a manual workflow into the JSON Schema accepting the same input', () => {
    const result = upgradeLegacyWorkflowInputs(FIELD_MAP, { type: 'manual' });

    expect(result.changed).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(inputsOf(result.definitionYml)).toEqual({
      schema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'What to answer' },
          pages: { type: 'integer' },
          tags: {
            type: 'array',
            items: { type: 'string', enum: ['a', 'b'] },
          },
          filters: {
            type: 'object',
            properties: { lang: { type: 'string' } },
            additionalProperties: false,
          },
          extra: { type: 'object' },
        },
        additionalProperties: false,
      },
    });
    expect(validateWorkflow(result.definitionYml).success).toBe(true);
  });

  it('keeps the rest of the definition, comments included', () => {
    const result = upgradeLegacyWorkflowInputs(FIELD_MAP, { type: 'manual' });

    expect(result.definitionYml).toContain('# Greets the caller.');
    expect(parse(result.definitionYml)).toEqual({
      ...parse(FLOW),
      inputs: inputsOf(result.definitionYml),
    });
  });

  it('treats a field named "type" as a field', () => {
    const result = upgradeLegacyWorkflowInputs(
      withInputs('inputs:\n  schema:\n    type:\n      type: string\n'),
      { type: 'manual' },
    );

    expect(inputsOf(result.definitionYml)).toEqual({
      schema: {
        type: 'object',
        properties: { type: { type: 'string' } },
        additionalProperties: false,
      },
    });
  });

  it('writes the input schema of the workflow record before the flow of a manual workflow that declared no input', () => {
    const inputSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { question: { type: 'string', default: 'hi' } },
      required: ['question'],
      additionalProperties: false,
    };
    const result = upgradeLegacyWorkflowInputs(FLOW, {
      type: 'manual',
      inputSchema,
    });

    expect(result.changed).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(inputsOf(result.definitionYml)).toEqual({ schema: inputSchema });
    expect(Object.keys(parse(result.definitionYml))).toEqual([
      'defs',
      'inputs',
      'flow',
      'outputs',
    ]);
    expect(validateWorkflow(result.definitionYml).success).toBe(true);
  });

  it('lets the input schema of the workflow record replace the declared fields, and says so', () => {
    const inputSchema = {
      type: 'object',
      properties: { topic: { type: 'string' } },
    };
    const result = upgradeLegacyWorkflowInputs(FIELD_MAP, {
      type: 'manual',
      inputSchema,
    });

    expect(inputsOf(result.definitionYml)).toEqual({ schema: inputSchema });
    expect(result.warnings).toEqual([
      'the fields the definition declared (question, pages, tags, filters, ' +
        'extra) were replaced by the input schema of the workflow',
    ]);
  });

  it.each([
    [
      'the default of a manual workflow',
      {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {},
        additionalProperties: {},
      },
    ],
    ['an empty schema', {}],
    ['no schema', undefined],
    ['a value that is not a schema', 'object'],
  ])(
    'converts the declared fields when the record carries %s',
    (_, inputSchema) => {
      const result = upgradeLegacyWorkflowInputs(
        withInputs('inputs:\n  schema:\n    question:\n      type: string\n'),
        { type: 'manual', inputSchema },
      );

      expect(inputsOf(result.definitionYml)).toEqual({
        schema: {
          type: 'object',
          properties: { question: { type: 'string' } },
          additionalProperties: false,
        },
      });
      expect(result.warnings).toEqual([]);
    },
  );

  it('leaves a manual workflow that declares nothing as it is', () => {
    expect(upgradeLegacyWorkflowInputs(FLOW, { type: 'manual' })).toEqual({
      definitionYml: FLOW,
      changed: false,
      warnings: [],
    });
  });

  it('keeps a record schema that refuses every field', () => {
    const inputSchema = {
      type: 'object',
      properties: {},
      additionalProperties: false,
    };
    const result = upgradeLegacyWorkflowInputs(FLOW, {
      type: 'manual',
      inputSchema,
    });

    expect(inputsOf(result.definitionYml)).toEqual({ schema: inputSchema });
  });

  it('gives a record schema without a type the object type', () => {
    const result = upgradeLegacyWorkflowInputs(FLOW, {
      type: 'manual',
      inputSchema: { properties: { question: { type: 'string' } } },
    });

    expect(inputsOf(result.definitionYml)).toEqual({
      schema: {
        type: 'object',
        properties: { question: { type: 'string' } },
      },
    });
  });

  it('drops a record schema no input could match, and says so', () => {
    const result = upgradeLegacyWorkflowInputs(FLOW, {
      type: 'manual',
      inputSchema: { type: 'string' },
    });

    expect(result.changed).toBe(false);
    expect(result.definitionYml).toBe(FLOW);
    expect(result.warnings).toEqual([
      'the input schema of the workflow does not describe an object and ' +
        'was dropped (no run could match it)',
    ]);
  });

  it('removes an empty field map', () => {
    const result = upgradeLegacyWorkflowInputs(
      withInputs('inputs:\n  schema: {}\n'),
      { type: 'manual' },
    );

    expect(result.changed).toBe(true);
    expect(parse(result.definitionYml)).toEqual(parse(FLOW));
  });

  it.each(['conversational', 'scheduled'])(
    'removes the inputs of a %s workflow, whatever its record carries',
    (type) => {
      const result = upgradeLegacyWorkflowInputs(FIELD_MAP, {
        type,
        inputSchema: { type: 'object', properties: { text: {} } },
      });

      expect(result.changed).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(parse(result.definitionYml)).toEqual(parse(FLOW));
      expect(result.definitionYml).toContain('# Greets the caller.');
    },
  );

  it('leaves a conversational workflow without inputs as it is', () => {
    expect(
      upgradeLegacyWorkflowInputs(FLOW, { type: 'conversational' }),
    ).toEqual({ definitionYml: FLOW, changed: false, warnings: [] });
  });

  it('returns an upgraded definition unchanged, whatever the record carries', () => {
    const upgraded = upgradeLegacyWorkflowInputs(FIELD_MAP, {
      type: 'manual',
    }).definitionYml;

    expect(
      upgradeLegacyWorkflowInputs(upgraded, {
        type: 'manual',
        inputSchema: { type: 'object', properties: { topic: {} } },
      }),
    ).toEqual({ definitionYml: upgraded, changed: false, warnings: [] });
  });

  it('leaves a definition that is not valid YAML as it is', () => {
    const broken = 'flow: [\n  - do: greet\n';

    expect(
      upgradeLegacyWorkflowInputs(broken, {
        type: 'manual',
        inputSchema: { type: 'object', properties: { topic: {} } },
      }),
    ).toEqual({ definitionYml: broken, changed: false, warnings: [] });
  });
});

describe('extractWorkflowInputs', () => {
  it('takes the inputs out of the definition and gives their schema', () => {
    const upgraded = upgradeLegacyWorkflowInputs(FIELD_MAP, {
      type: 'manual',
    }).definitionYml;
    const result = extractWorkflowInputs(upgraded);

    expect(result.changed).toBe(true);
    expect(parse(result.definitionYml)).toEqual(parse(FLOW));
    expect(result.inputSchema).toEqual(
      (inputsOf(upgraded) as { schema: unknown }).schema,
    );
  });

  it('leaves a definition without inputs as it is', () => {
    expect(extractWorkflowInputs(FLOW)).toEqual({
      definitionYml: FLOW,
      changed: false,
    });
  });
});
