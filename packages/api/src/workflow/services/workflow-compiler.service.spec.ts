/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Workflow as AgenticWorkflow } from '@hexabot-ai/agentic';
import type { WorkflowRunFull } from '@hexabot-ai/types';

import { ActionService } from '@/actions/actions.service';
import { RuntimeBindingsService } from '@/bindings/runtime-bindings.service';
import { I18nService } from '@/i18n/services/i18n.service';
import { messagingWorkflowDefinition } from '@/utils/test/fixtures/workflow';

import { ManualEventWrapper } from '../lib/trigger-event-wrapper';
import { WorkflowType } from '../types';

import { WorkflowCompiler } from './workflow-compiler.service';

describe('WorkflowCompiler', () => {
  const actions = { greet: {} };
  const bindingKinds = { http: {} };
  const actionService = { getRegistry: jest.fn(() => actions) };
  const runtimeBindingsService = { getRegistry: jest.fn(() => bindingKinds) };
  const i18n = { t: jest.fn(() => 'Bonjour Ada') };
  const compiler = new WorkflowCompiler(
    actionService as unknown as ActionService,
    runtimeBindingsService as unknown as RuntimeBindingsService,
    i18n as unknown as I18nService,
  );
  const buildRun = (
    definitionYml?: string,
    type: WorkflowType = WorkflowType.conversational,
  ) =>
    ({
      id: 'run-1',
      workflow: { id: 'workflow-1', type },
      workflowVersion: definitionYml ? { definitionYml } : null,
    }) as unknown as WorkflowRunFull;
  const event = new ManualEventWrapper({}, 'user-1');
  event.setInitiator({ id: 'user-1', language: 'fr' } as any);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns nothing when the run pins no definition', () => {
    expect(compiler.compile(buildRun(), event)).toBeUndefined();
    expect(compiler.compile(buildRun('  '), event)).toBeUndefined();
  });

  it('compiles the pinned definition against the registered actions and binding kinds', () => {
    const workflow = {} as AgenticWorkflow;
    const fromDefinition = jest
      .spyOn(AgenticWorkflow, 'fromDefinition')
      .mockReturnValue(workflow);
    const compiled = compiler.compile(
      buildRun(
        AgenticWorkflow.stringifyDefinition(messagingWorkflowDefinition),
      ),
      event,
    );

    expect(compiled).toEqual({
      definition: messagingWorkflowDefinition,
      workflow,
    });
    expect(fromDefinition).toHaveBeenCalledWith(messagingWorkflowDefinition, {
      actions,
      bindingKinds,
      jsonataFunctions: { t: expect.any(Function) },
    });
  });

  it('translates with the language of the initiator', () => {
    const fromDefinition = jest
      .spyOn(AgenticWorkflow, 'fromDefinition')
      .mockReturnValue({} as AgenticWorkflow);

    compiler.compile(
      buildRun(
        AgenticWorkflow.stringifyDefinition(messagingWorkflowDefinition),
      ),
      event,
    );
    const { t } = fromDefinition.mock.calls[0][1].jsonataFunctions as {
      t: (key: string, args?: Record<string, unknown>) => string;
    };

    expect(t('greeting', { name: 'Ada' })).toBe('Bonjour Ada');
    expect(i18n.t).toHaveBeenCalledWith('greeting', {
      lang: 'fr',
      defaultValue: 'greeting',
      args: { name: 'Ada' },
    });
  });

  it('throws when the pinned definition no longer parses', () => {
    expect(() => compiler.compile(buildRun('flow: [unclosed'), event)).toThrow(
      'Invalid workflow YAML',
    );
  });

  it('refuses a definition with an action its workflow type cannot run', () => {
    actionService.getRegistry.mockReturnValueOnce({
      await_reply: { workflowTypes: [WorkflowType.conversational] },
    } as any);
    const fromDefinition = jest.spyOn(AgenticWorkflow, 'fromDefinition');
    const definitionYml = [
      'defs:',
      '  ask:',
      '    kind: task',
      '    action: await_reply',
      'flow:',
      '  - do: ask',
      'outputs: {}',
    ].join('\n');

    expect(() =>
      compiler.compile(buildRun(definitionYml, WorkflowType.manual), event),
    ).toThrow('Actions not available in manual workflows: ask (await_reply)');
    expect(fromDefinition).not.toHaveBeenCalled();
  });
});
