/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z, type ZodType } from 'zod';

import type { WaitInfo } from '../checkpoint';
import { WorkflowResumeRejectedError } from '../errors';
import {
  checkResumePayload,
  describeResumePayload,
  findNonJsonTypes,
  isPayloadOptional,
} from '../resume-payload';
import { StepType } from '../workflow-event-emitter';

const waitFor = (accepts?: ZodType | Record<string, unknown>): WaitInfo => ({
  waitId: '0:ask@index:1',
  step: { id: '0:ask', name: 'ask', type: StepType.Task },
  suspendKey: 'index:1',
  accepts:
    accepts instanceof z.ZodType ? describeResumePayload(accepts) : accepts,
});
const precheck = (schema: ZodType, value: unknown) =>
  checkResumePayload(waitFor(schema), value).ok;

describe('describeResumePayload', () => {
  it('describes the input side of the schema as JSON Schema', () => {
    expect(
      describeResumePayload(
        z.object({
          reply: z.string().min(1).describe('The answer'),
          count: z.number().default(1),
        }),
      ),
    ).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        reply: { type: 'string', minLength: 1, description: 'The answer' },
        count: { type: 'number' },
      },
      required: ['reply'],
    });
  });

  // Each value is accepted by the Zod schema but would be refused by the
  // JSON Schema zod generates for it; the relaxed description must accept it.
  it.each<[string, ZodType, unknown]>([
    ['coerced primitive', z.object({ n: z.coerce.number() }), { n: '5' }],
    ['preprocess', z.preprocess((v) => String(v), z.string()), 5],
    ['catch', z.string().catch('fallback'), 5],
    ['custom', z.custom<string>((v) => typeof v === 'string'), 'x'],
    ['trim before max', z.string().trim().max(3), ' ab '],
    ['overwrite before max', z.number().overwrite(Math.round).max(5), 5.4],
    ['regex flags', z.string().regex(/^abc$/i), 'ABC'],
    ['custom email pattern', z.email({ pattern: /^.+@.+$/ }), 'a@b'],
    [
      'partial record of enum keys',
      z.partialRecord(z.enum(['a', 'b']), z.number()),
      { a: 1 },
    ],
    [
      'coerce inside optional, arrays and unions',
      z.object({
        a: z.coerce.number().optional(),
        b: z.array(z.coerce.number()),
        c: z.union([z.coerce.number(), z.boolean()]),
      }),
      { a: '1', b: ['2'], c: '3' },
    ],
  ])('never refuses what the schema accepts: %s', (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
    expect(precheck(schema, value)).toBe(true);
  });

  it.each<[string, ZodType, unknown]>([
    ['wrong type', z.object({ reply: z.string() }), { reply: 1 }],
    ['missing key', z.object({ reply: z.string() }), {}],
    ['not an object', z.object({ reply: z.string() }), null],
    [
      'strict object extras',
      z.strictObject({ a: z.string() }),
      { a: 'x', b: 1 },
    ],
    ['enum', z.enum(['yes', 'no']), 'maybe'],
    ['integer', z.int(), 1.5],
    ['length', z.string().max(2), 'abc'],
    [
      'discriminated union',
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), x: z.string() }),
        z.object({ kind: z.literal('b') }),
      ]),
      { kind: 'a' },
    ],
    [
      'recursive schema',
      (() => {
        const node = z.object({
          value: z.number(),
          get next() {
            return node.optional();
          },
        });

        return node;
      })(),
      { value: 1, next: { value: 'two' } },
    ],
  ])('still refuses what JSON Schema can check: %s', (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
    expect(precheck(schema, value)).toBe(false);
  });
});

describe('isPayloadOptional', () => {
  it.each<[string, ZodType, boolean]>([
    ['optional', z.object({ note: z.string() }).optional(), true],
    ['default', z.object({ note: z.string() }).default({ note: '' }), true],
    ['nullish', z.string().nullish(), true],
    ['undefined', z.undefined(), true],
    ['void', z.void(), true],
    ['object', z.object({ note: z.string() }), false],
    ['nullable', z.string().nullable(), false],
  ])(
    'reports whether %s accepts a missing payload',
    (_name, schema, optional) => {
      expect(isPayloadOptional(schema)).toBe(optional);
      expect(schema.safeParse(undefined).success).toBe(optional);
    },
  );
});

describe('findNonJsonTypes', () => {
  it.each<[string, ZodType, string[]]>([
    ['date', z.date(), ['(root) (date)']],
    [
      'nested types JSON cannot carry',
      z.object({
        at: z.date().optional(),
        items: z.array(z.object({ id: z.bigint() })),
        tags: z.set(z.string()),
        pair: z.tuple([z.string(), z.map(z.string(), z.number())]),
      }),
      ['at (date)', 'items[].id (bigint)', 'tags (set)', 'pair[1] (map)'],
    ],
    ['a dead union option', z.union([z.date(), z.string()]), ['(root) (date)']],
    ['plain JSON', z.object({ a: z.string(), b: z.array(z.number()) }), []],
    ['coerced', z.object({ at: z.coerce.date(), n: z.coerce.bigint() }), []],
    ['preprocessed', z.preprocess((v) => new Date(String(v)), z.date()), []],
    ['caught', z.date().catch(new Date(0)), []],
    [
      'codec from JSON',
      z.codec(z.iso.datetime(), z.date(), {
        decode: (value) => new Date(value),
        encode: (value) => value.toISOString(),
      }),
      [],
    ],
    ['transformed output', z.string().transform((v) => new Date(v)), []],
    [
      'recursive schema',
      (() => {
        const node = z.object({
          value: z.number(),
          get next() {
            return node.optional();
          },
        });

        return node;
      })(),
      [],
    ],
  ])('%s', (_name, schema, found) => {
    expect(findNonJsonTypes(schema)).toEqual(found);
  });
});

describe('checkResumePayload', () => {
  it('normalizes the payload the way the checkpoint stores it', () => {
    const wait = waitFor();

    expect(checkResumePayload(wait, undefined)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      checkResumePayload(wait, { at: new Date(0), gone: undefined }),
    ).toEqual({ ok: true, value: { at: '1970-01-01T00:00:00.000Z' } });
  });

  it('accepts a missing payload only when the schema lets it be left out', () => {
    const schema = z.object({ note: z.string() });
    const optional = {
      ...waitFor(schema.optional()),
      payloadOptional: true,
    };

    expect(checkResumePayload(optional, undefined).ok).toBe(true);
    expect(checkResumePayload(optional, { note: 1 }).ok).toBe(false);
    // `null` is a payload, which the optional schema still refuses.
    expect(checkResumePayload(optional, null).ok).toBe(false);
    expect(checkResumePayload(waitFor(schema), undefined).ok).toBe(false);
  });

  it('refuses a payload JSON cannot store', () => {
    const result = checkResumePayload(waitFor(), { n: BigInt(1) });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(WorkflowResumeRejectedError);
      expect(result.error.message).toMatch(
        /Resume payload for wait "0:ask@index:1" cannot be stored as JSON/,
      );
    }
  });

  it('checks the normalized payload and reports the issues', () => {
    const wait = waitFor(z.object({ at: z.string(), reply: z.string() }));

    expect(checkResumePayload(wait, { at: new Date(0), reply: 'ok' }).ok).toBe(
      true,
    );

    const result = checkResumePayload(wait, { at: 'now', reply: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(
        /^Resume payload for wait "0:ask@index:1" was rejected: reply: /,
      );
      expect(result.error.issues).toEqual([expect.stringMatching(/^reply: /)]);
    }
  });

  it('accepts anything when the wait has no usable schema', () => {
    expect(checkResumePayload(waitFor(), 'anything').ok).toBe(true);
    expect(
      checkResumePayload(waitFor({ type: 'not-a-json-type' }), 'anything').ok,
    ).toBe(true);
  });
});
