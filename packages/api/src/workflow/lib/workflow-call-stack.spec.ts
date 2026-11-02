/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  StepType,
  WaitInfo,
  WorkflowResumeRejectedError,
} from '@hexabot-ai/agentic';
import { WorkflowRunFull } from '@hexabot-ai/types';

import { AWAITING_CHILD_WORKFLOW_REASON, RunPass } from '../types';

import {
  followUps,
  getCalledWorkflowId,
  getChildRunId,
  getWaitedOnChildRunIds,
  resolveRunId,
  toCallWorkflowResult,
  toDeletedCallWorkflowResult,
  toEndedCallWorkflowResult,
} from './workflow-call-stack';

const buildWait = (overrides: Partial<WaitInfo> = {}): WaitInfo => ({
  waitId: 'call_child@index:1',
  step: { id: 'call_child', name: 'call_child', type: StepType.Task },
  suspendKey: 'index:1',
  reason: AWAITING_CHILD_WORKFLOW_REASON,
  data: { workflow_id: 'workflow-2', workflow_run_id: 'run-2' },
  ...overrides,
});
const buildRun = (overrides: Partial<WorkflowRunFull> = {}) =>
  ({
    id: 'run-2',
    workflow: { id: 'workflow-2' },
    status: 'finished',
    output: { done: true },
    error: null,
    ...overrides,
  }) as unknown as WorkflowRunFull;
const snapshot = { status: 'finished', actions: {} } as const;

describe('workflow-call-stack', () => {
  describe('resolveRunId', () => {
    it.each([
      ['an id', 'run-1', 'run-1'],
      ['a populated run', { id: 'run-1' }, 'run-1'],
      ['a run without id', { id: null }, null],
      ['no run', null, null],
      ['an unset relation', undefined, null],
    ])('reads %s', (_label, run, expected) => {
      expect(resolveRunId(run)).toBe(expected);
    });
  });

  describe('getChildRunId', () => {
    it('reads the child run a call waits on', () => {
      expect(getChildRunId(buildWait())).toBe('run-2');
    });

    it.each([
      ['another kind of wait', buildWait({ reason: 'awaiting_approval' })],
      ['a wait without data', buildWait({ data: null })],
      ['a malformed run id', buildWait({ data: { workflow_run_id: 42 } })],
    ])('ignores %s', (_label, wait) => {
      expect(getChildRunId(wait)).toBeUndefined();
    });
  });

  describe('getWaitedOnChildRunIds', () => {
    it('reads the child runs the calls among the waits wait on', () => {
      expect(
        getWaitedOnChildRunIds([
          buildWait(),
          buildWait({
            reason: 'awaiting_approval',
            data: { workflow_run_id: 'run-4' },
          }),
          buildWait({ data: { workflow_run_id: 'run-3' } }),
        ]),
      ).toEqual(new Set(['run-2', 'run-3']));
    });
  });

  describe('getCalledWorkflowId', () => {
    it('reads the workflow a call called', () => {
      expect(getCalledWorkflowId(buildWait())).toBe('workflow-2');
    });

    it.each([
      ['a wait without data', buildWait({ data: null })],
      ['a malformed workflow id', buildWait({ data: { workflow_id: 42 } })],
    ])('ignores %s', (_label, wait) => {
      expect(getCalledWorkflowId(wait)).toBeUndefined();
    });
  });

  describe('toDeletedCallWorkflowResult', () => {
    it('fails a call whose run was deleted', () => {
      expect(toDeletedCallWorkflowResult(buildWait(), 'run-2', true)).toEqual({
        status: 'failed',
        workflow_id: 'workflow-2',
        workflow_run_id: 'run-2',
        error: 'Called workflow run run-2 was deleted',
      });
    });

    it('fails a call whose workflow was deleted', () => {
      expect(toDeletedCallWorkflowResult(buildWait(), 'run-2', false)).toEqual({
        status: 'failed',
        workflow_id: 'workflow-2',
        workflow_run_id: 'run-2',
        error: 'Called workflow workflow-2 was deleted',
      });
    });

    it('fails a call whose wait names no workflow', () => {
      expect(
        toDeletedCallWorkflowResult(
          buildWait({ data: { workflow_run_id: 'run-2' } }),
          'run-2',
          false,
        ),
      ).toEqual({
        status: 'failed',
        workflow_id: '',
        workflow_run_id: 'run-2',
        error: 'Called workflow undefined was deleted',
      });
    });
  });

  describe('followUps', () => {
    const run = {
      id: 'run-1',
      parentRun: 'run-0',
    } as unknown as WorkflowRunFull;
    const waits = [buildWait()];

    it.each<[string, RunPass, (string | null)[]]>([
      ['a run taken over to whoever settled it', { status: 'claim_lost' }, []],
      [
        'a refused run to itself',
        {
          status: 'rejected',
          waits,
          error: new WorkflowResumeRejectedError('Refused'),
        },
        ['run-1'],
      ],
      [
        'a suspended run to itself',
        {
          status: 'settled',
          result: {
            status: 'suspended',
            waits,
            checkpoint: { waits } as never,
            snapshot: { status: 'suspended', actions: {} },
          },
        },
        ['run-1'],
      ],
      [
        'a finished run to itself and its parent',
        {
          status: 'settled',
          result: { status: 'finished', output: {}, snapshot },
        },
        ['run-1', 'run-0'],
      ],
      [
        'a crashed run to itself and its parent',
        { status: 'crashed', error: new Error('runner-crash') },
        ['run-1', 'run-0'],
      ],
    ])('leaves %s', (_label, pass, runIds) => {
      expect(followUps(run, pass)).toEqual(runIds);
    });
  });

  describe('toCallWorkflowResult', () => {
    it('returns the output of a finished run', () => {
      expect(
        toCallWorkflowResult(buildRun(), {
          status: 'finished',
          output: { done: true },
          snapshot,
        }),
      ).toEqual({
        status: 'finished',
        workflow_id: 'workflow-2',
        workflow_run_id: 'run-2',
        output: { done: true },
      });
    });

    it('reports a suspended run', () => {
      expect(
        toCallWorkflowResult(buildRun(), {
          status: 'suspended',
          waits: [],
          checkpoint: {} as never,
          snapshot: { status: 'suspended', actions: {} },
        }),
      ).toEqual({
        status: 'suspended',
        workflow_id: 'workflow-2',
        workflow_run_id: 'run-2',
      });
    });

    it('reports the error of a failed run', () => {
      expect(
        toCallWorkflowResult(buildRun(), {
          status: 'failed',
          error: new Error('boom'),
          snapshot: { status: 'failed', actions: {} },
        }),
      ).toEqual(expect.objectContaining({ status: 'failed', error: 'boom' }));
    });
  });

  describe('toEndedCallWorkflowResult', () => {
    it('returns the stored output of a finished run', () => {
      expect(toEndedCallWorkflowResult(buildRun())).toEqual({
        status: 'finished',
        workflow_id: 'workflow-2',
        workflow_run_id: 'run-2',
        output: { done: true },
      });
    });

    it('returns an empty output when a finished run stored none', () => {
      expect(toEndedCallWorkflowResult(buildRun({ output: null }))).toEqual(
        expect.objectContaining({ status: 'finished', output: {} }),
      );
    });

    it.each([
      ['its stored error', 'boom', 'boom'],
      ['a default error', null, 'Child workflow run failed'],
    ])('fails a failed run with %s', (_label, error, expected) => {
      expect(
        toEndedCallWorkflowResult(buildRun({ status: 'failed', error })),
      ).toEqual(expect.objectContaining({ status: 'failed', error: expected }));
    });
  });
});
