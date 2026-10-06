/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { defineAction } from '../action/action';
import { BaseWorkflowContext } from '../context';
import type { Settings, WorkflowDefinition } from '../dsl.types';
import { compileWorkflow } from '../workflow-compiler';
import type { EventEmitterLike } from '../workflow-event-emitter';
import { fingerprintWorkflow } from '../workflow-fingerprint';

import { createTaskDefs } from './test-helpers';

class TestContext extends BaseWorkflowContext {
  public eventEmitter: EventEmitterLike = { emit: jest.fn(), on: jest.fn() };
}

const noop = (name: string) =>
  defineAction<unknown, unknown, TestContext, Settings>({
    name,
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async () => undefined,
  });
const actions = { first: noop('first'), second: noop('second') };
const fingerprint = (definition: WorkflowDefinition) =>
  fingerprintWorkflow(compileWorkflow(definition, { actions }));
const createDefinition = (): WorkflowDefinition => ({
  defs: createTaskDefs({
    ask: { action: 'first', inputs: { label: 'x', count: '=1' } },
    note: { action: 'first' },
  }),
  flow: [
    {
      conditional: {
        when: [
          { condition: '=$input.ok', steps: [{ do: 'note' }] },
          { else: true, steps: [{ do: 'ask' }] },
        ],
      },
    },
    {
      loop: {
        type: 'for_each',
        name: 'items',
        for_each: { item: 'item', in: '=["a", "b"]' },
        until: '=false',
        accumulate: {
          as: 'acc',
          initial: [],
          merge: '=$append($accumulator, [1])',
        },
        steps: [{ do: 'ask' }],
      },
    },
    {
      loop: {
        type: 'while',
        name: 'retry',
        while: '=$count($accumulator) < 1',
        accumulate: {
          as: 'n',
          initial: [],
          merge: '=$append($accumulator, 1)',
        },
        steps: [{ do: 'note' }],
      },
    },
    {
      parallel: {
        strategy: 'wait_all',
        steps: [{ do: 'note' }, { do: 'ask' }],
      },
    },
  ],
  outputs: { acc: '=$output.items.acc' },
});

type Mutation = (definition: any) => void;

describe('fingerprintWorkflow', () => {
  it('is stable across compilations of the same definition', () => {
    expect(fingerprint(createDefinition())).toBe(
      fingerprint(createDefinition()),
    );
  });

  it.each<[string, Mutation]>([
    [
      'task settings',
      (definition) => {
        definition.defs.ask.settings = { timeout_ms: 5 };
      },
    ],
    [
      'the key order of task inputs',
      (definition) => {
        definition.defs.ask.inputs = { count: '=1', label: 'x' };
      },
    ],
  ])('ignores %s', (_label, mutate) => {
    const next = createDefinition();
    mutate(next);

    expect(fingerprint(next)).toBe(fingerprint(createDefinition()));
  });

  it.each<[string, Mutation]>([
    [
      'a renamed task',
      (definition) => {
        definition.defs.prompt = definition.defs.ask;
        delete definition.defs.ask;
        definition.flow[1].loop.steps = [{ do: 'prompt' }];
      },
    ],
    [
      'an inserted step',
      (definition) => definition.flow.unshift({ do: 'note' }),
    ],
    ['task inputs', (definition) => (definition.defs.ask.inputs.label = 'y')],
    ['a task action', (definition) => (definition.defs.note.action = 'second')],
    [
      'a branch condition',
      (definition) => (definition.flow[0].conditional.when[0].condition = '=1'),
    ],
    [
      'the for_each items',
      (definition) => (definition.flow[1].loop.for_each.in = '=["a"]'),
    ],
    [
      'an until expression',
      (definition) => (definition.flow[1].loop.until = '=true'),
    ],
    [
      'an accumulator initial value',
      (definition) => (definition.flow[1].loop.accumulate.initial = [0]),
    ],
    [
      'an accumulator merge',
      (definition) =>
        (definition.flow[1].loop.accumulate.merge = '=$accumulator'),
    ],
    ['a loop name', (definition) => (definition.flow[1].loop.name = 'entries')],
    [
      'a while guard',
      (definition) =>
        (definition.flow[2].loop.while = '=$count($accumulator) < 2'),
    ],
    [
      'a parallel strategy',
      (definition) => (definition.flow[3].parallel.strategy = 'wait_any'),
    ],
    ['an output mapping', (definition) => (definition.outputs.acc = '=1')],
  ])('changes with %s', (_label, mutate) => {
    const next = createDefinition();
    mutate(next);

    expect(fingerprint(next)).not.toBe(fingerprint(createDefinition()));
  });
});
