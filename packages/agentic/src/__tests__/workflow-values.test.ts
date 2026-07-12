/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { BaseWorkflowContext } from '../context';
import type { Settings } from '../dsl.types';
import { EventEmitterLike } from '../workflow-event-emitter';
import {
  compileValue,
  evaluateMapping,
  evaluateValue,
  mergeSettings,
} from '../workflow-values';

class TestContext extends BaseWorkflowContext {
  public eventEmitter: EventEmitterLike = { emit: jest.fn(), on: jest.fn() };

  constructor() {
    super({});
  }
}

describe('workflow values', () => {
  it('registers custom JSONata functions on expressions', async () => {
    const translate = jest.fn((text: string) => `translated:${text}`);
    const compiled = compileValue("=$i18n('Bye bye')", {
      jsonataFunctions: { i18n: translate },
    });
    const result = await evaluateValue(compiled, {
      input: {},
      context: new TestContext().state,
      output: {},
    });

    expect(result).toBe('translated:Bye bye');
    expect(translate).toHaveBeenCalledWith('Bye bye');
  });

  it('compiles expressions and evaluates against the runtime scope', async () => {
    const compiled = compileValue(
      '=$input.amount + $context.offset + $iteration.index + $accumulator',
    );
    const result = await evaluateValue(compiled, {
      input: { amount: 10 },
      context: { offset: 5 },
      output: {},
      iteration: { item: 'item', index: 2 },
      accumulator: 3,
      result: { value: 7 },
    });

    expect(result).toBe(20);
  });

  it('returns literal values unchanged and evaluates mappings', async () => {
    const literal = compileValue({ raw: true });
    const mapping = {
      literal,
      expression: compileValue('=$result.value'),
    };
    const values = await evaluateMapping(mapping, {
      input: {},
      context: new TestContext().state,
      output: {},
      result: { value: 42 },
    });

    expect(values).toEqual({
      literal: { raw: true },
      expression: 42,
    });
  });

  it('evaluates nested expressions inside literal objects', async () => {
    const mapping = {
      headers: compileValue({
        nestedFiled: '=$input.headerValue',
      }),
    };
    const values = await evaluateMapping(mapping, {
      input: { headerValue: 'Bearer token-value' },
      context: new TestContext().state,
      output: {},
    });

    expect(values).toEqual({
      headers: {
        nestedFiled: 'Bearer token-value',
      },
    });
  });

  it('registers custom functions on nested expressions inside literal values', async () => {
    const translate = jest.fn((key: string) => `translated:${key}`);
    const mapping = {
      payload: compileValue(
        {
          title: "=$t('Title')",
          actions: ['=$t("Confirm")', { label: "=$t('Cancel')" }],
        },
        { jsonataFunctions: { t: translate } },
      ),
    };
    const values = await evaluateMapping(mapping, {
      input: {},
      context: new TestContext().state,
      output: {},
    });

    expect(values).toEqual({
      payload: {
        title: 'translated:Title',
        actions: ['translated:Confirm', { label: 'translated:Cancel' }],
      },
    });
    expect(translate).toHaveBeenCalledTimes(3);
  });

  it('handles missing mappings and deep merges settings', async () => {
    await expect(
      evaluateMapping(undefined, {
        input: {},
        context: new TestContext().state,
        output: {},
      }),
    ).resolves.toEqual({});

    const merged = mergeSettings(
      {
        timeout_ms: 10,
        retries: {
          enabled: true,
          max_attempts: 3,
          backoff_ms: 10,
          max_delay_ms: 100,
          jitter: 0,
          multiplier: 2,
        },
        llm: {
          model: 'gpt-4o',
          options: { temperature: 0.2, top_p: 0.9 },
        },
      } satisfies Partial<Settings>,
      {
        retries: {
          enabled: true,
          max_attempts: 5,
          backoff_ms: 10,
          max_delay_ms: 100,
          jitter: 0,
          multiplier: 1,
        },
        llm: {
          options: { temperature: 0.5 },
        },
      },
    );

    expect(merged).toEqual({
      timeout_ms: 10,
      retries: {
        enabled: true,
        max_attempts: 5,
        backoff_ms: 10,
        max_delay_ms: 100,
        jitter: 0,
        multiplier: 1,
      },
      llm: {
        model: 'gpt-4o',
        options: { temperature: 0.5, top_p: 0.9 },
      },
    });
  });
});
