/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z, type ZodType } from 'zod';

import {
  NonDeterministicWorkflowError,
  WorkflowResumeRejectedError,
} from '../errors';
import { RunnerRuntimeControl } from '../runner-runtime-control';
import { StepType, type StepInfo } from '../workflow-event-emitter';

const step: StepInfo = { id: '0:ask', name: 'ask', type: StepType.Task };

describe('RunnerRuntimeControl', () => {
  it('refuses to suspend outside a running step', () => {
    const runtime = new RunnerRuntimeControl();

    expect(() => runtime.suspend()).toThrow(
      'workflow.suspend() can only be called while a workflow step is running.',
    );
    expect(() => runtime.waitForSuspension()).toThrow(
      'No workflow step is running in this scope.',
    );
    expect(runtime.hasRecordedResult()).toBe(false);
  });

  it('queues a suspension requested before the executor waits for it', async () => {
    const runtime = new RunnerRuntimeControl();

    runtime.beginStep(step);
    void runtime.suspend({ reason: 'first', data: { n: 1 } });

    await expect(runtime.waitForSuspension()).resolves.toEqual({
      suspendKey: 'index:1',
      reason: 'first',
      data: { n: 1 },
      awaitResults: {},
    });
  });

  it('resolves recorded suspensions immediately and reports them ahead of time', async () => {
    const runtime = new RunnerRuntimeControl();

    runtime.beginStep(step, {
      seed: {
        awaitResults: { 'index:1': 'a', 'key:confirm': 'b' },
        expected: { suspendKey: 'key:confirm' },
      },
    });

    expect(runtime.hasRecordedResult()).toBe(true);
    await expect(runtime.suspend()).resolves.toBe('a');
    expect(runtime.hasRecordedResult('confirm')).toBe(true);
    await expect(runtime.suspend({ key: 'confirm' })).resolves.toBe('b');
    expect(runtime.hasRecordedResult()).toBe(false);
    expect(() => runtime.endStep({ completed: true })).not.toThrow();
  });

  it.each<[string, ZodType | undefined]>([
    ['without accepts', undefined],
    ['with z.any()', z.any()],
    ['with a nested z.unknown()', z.object({ meta: z.unknown() })],
  ])(
    'records a result again unchanged by a body that changed it, %s',
    async (_label, accepts) => {
      const runtime = new RunnerRuntimeControl();

      runtime.beginStep(step, {
        seed: {
          awaitResults: { 'index:1': { meta: { n: 1 } } },
          expected: { suspendKey: 'index:1' },
        },
      });

      const answer = (await runtime.suspend({ accepts })) as {
        meta: { n: number };
      };
      answer.meta.n += 1;
      void runtime.suspend();

      await expect(runtime.waitForSuspension()).resolves.toMatchObject({
        suspendKey: 'index:2',
        awaitResults: { 'index:1': { meta: { n: 1 } } },
      });
    },
  );

  it('rejects a user key reused within one attempt, but not across attempts', async () => {
    const runtime = new RunnerRuntimeControl();

    runtime.beginStep(step);
    const rewind = runtime.markSuspendCursor();
    void runtime.suspend({ key: 'confirm' });
    expect(() => runtime.suspend({ key: 'confirm' })).toThrow(
      /key "confirm" is used more than once in step "0:ask"/,
    );

    rewind();
    expect(() => runtime.suspend({ key: 'confirm' })).not.toThrow();
  });

  it('rewinds the cursor to where an action run started, at any depth', async () => {
    const runtime = new RunnerRuntimeControl();
    const keys: string[] = [];
    const next = async () => {
      keys.push((await runtime.waitForSuspension()).suspendKey);
    };

    runtime.beginStep(step);
    const rewindStep = runtime.markSuspendCursor();
    void runtime.suspend();
    await next();

    // An action run nested in the body starts after the body's first suspend,
    const rewindNested = runtime.markSuspendCursor();
    void runtime.suspend();
    await next();
    // so its retry reproduces its own keys and leaves the body's alone.
    rewindNested();
    void runtime.suspend();
    await next();

    rewindStep();
    void runtime.suspend();
    await next();

    expect(keys).toEqual(['index:1', 'index:2', 'index:2', 'index:1']);
  });

  it('ignores a rewind taken in a step that has ended', async () => {
    const runtime = new RunnerRuntimeControl();

    runtime.beginStep(step);
    const stale = runtime.markSuspendCursor();
    runtime.endStep();
    runtime.beginStep(step);
    void runtime.suspend({ key: 'confirm' });

    stale();
    expect(() => runtime.suspend({ key: 'confirm' })).toThrow(
      /used more than once/,
    );
    // Outside a running step there is nothing to rewind.
    runtime.endStep();
    expect(() => runtime.markSuspendCursor()()).not.toThrow();
  });

  describe('determinism', () => {
    const seed = {
      awaitResults: { 'index:1': 'a' },
      expected: { suspendKey: 'index:2', reason: 'second' },
    };

    it('fails a resumed body that completes without reaching its suspension', () => {
      const runtime = new RunnerRuntimeControl();

      runtime.beginStep(step, { seed });

      expect(() => runtime.endStep({ completed: true })).toThrow(
        NonDeterministicWorkflowError,
      );
    });

    it('does not check a body that stopped without completing', () => {
      const runtime = new RunnerRuntimeControl();

      runtime.beginStep(step, { seed });

      expect(() => runtime.endStep()).not.toThrow();
    });

    it('fails a resumed body that reaches an unrecorded suspension first', () => {
      const runtime = new RunnerRuntimeControl();

      runtime.beginStep(step, { seed });

      expect(() => runtime.suspend({ key: 'new' })).toThrow(
        /reached unexpected suspend "key:new" before expected "index:2"/,
      );
    });

    it('fails a resumed body that reaches its suspension with another reason', async () => {
      const runtime = new RunnerRuntimeControl();

      runtime.beginStep(step, { seed });
      await expect(runtime.suspend()).resolves.toBe('a');

      expect(() => runtime.suspend({ reason: 'other' })).toThrow(
        /with reason "other", expected reason "second"/,
      );
    });
  });

  describe('accepts', () => {
    const accepts = z.object({ n: z.coerce.number() });

    it('stores what the suspension accepts on its request', async () => {
      const runtime = new RunnerRuntimeControl();

      runtime.beginStep(step);
      void runtime.suspend({ accepts: z.object({ reply: z.string() }) });

      await expect(runtime.waitForSuspension()).resolves.toMatchObject({
        suspendKey: 'index:1',
        accepts: {
          type: 'object',
          properties: { reply: { type: 'string' } },
          required: ['reply'],
        },
      });
    });

    it('resolves a recorded result parsed through the schema', async () => {
      const runtime = new RunnerRuntimeControl();

      runtime.beginStep(step, {
        seed: {
          awaitResults: { 'index:1': { n: '5' } },
          expected: { suspendKey: 'index:1' },
        },
      });

      expect(runtime.hasReachedResolvedSuspension()).toBe(false);
      await expect(runtime.suspend({ accepts })).resolves.toEqual({ n: 5 });
      expect(runtime.hasReachedResolvedSuspension()).toBe(true);
    });

    it('refuses the resolved payload when it fails the schema', async () => {
      const runtime = new RunnerRuntimeControl();

      runtime.beginStep(step, {
        seed: {
          awaitResults: { 'index:1': { n: 'five' } },
          expected: { suspendKey: 'index:1' },
        },
      });

      const refused = runtime.suspend({ accepts });
      await expect(refused).rejects.toThrow(WorkflowResumeRejectedError);
      await expect(refused).rejects.toThrow(
        /^Resume payload for step "0:ask" was rejected: n: /,
      );
      expect(runtime.hasReachedResolvedSuspension()).toBe(true);
    });

    it('fails when a result accepted by an earlier pass no longer matches', async () => {
      const runtime = new RunnerRuntimeControl();

      runtime.beginStep(step, {
        seed: {
          awaitResults: { 'index:1': { n: 'five' }, 'index:2': 'b' },
          expected: { suspendKey: 'index:2' },
        },
      });

      await expect(runtime.suspend({ accepts })).rejects.toThrow(
        NonDeterministicWorkflowError,
      );
    });
  });
});
