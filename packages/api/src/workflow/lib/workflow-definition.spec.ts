/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowType } from '../types';

import {
  assertTaskActionsSupported,
  parseWorkflowDefinition,
} from './workflow-definition';

describe('parseWorkflowDefinition', () => {
  it('returns the parsed definition for valid YAML', () => {
    const definition = parseWorkflowDefinition(
      [
        'defs:',
        '  greet:',
        '    kind: task',
        '    action: greet_action',
        'flow:',
        '  - do: greet',
        'outputs:',
        '  result: "=true"',
      ].join('\n'),
    );

    expect(Object.keys(definition.defs)).toEqual(['greet']);
    expect(definition.flow).toEqual([{ do: 'greet' }]);
  });

  it('throws with messages derived from the structured validation issues', () => {
    const invalidYaml = [
      'defs:',
      '  greet:',
      '    kind: task',
      '    action: greet_action',
      'flow:',
      '  - do: ghost_task',
      '  - do: phantom_task',
      'outputs:',
      '  result: "=true"',
    ].join('\n');

    expect(() => parseWorkflowDefinition(invalidYaml)).toThrow(
      'Invalid workflow YAML: ' +
        'Unknown task(s) referenced in flow: ghost_task; ' +
        'Unknown task(s) referenced in flow: phantom_task',
    );
  });
});

describe('assertTaskActionsSupported', () => {
  const definition = parseWorkflowDefinition(
    [
      'defs:',
      '  ask:',
      '    kind: task',
      '    action: await_reply',
      '  reply:',
      '    kind: task',
      '    action: send_text_message',
      '  log:',
      '    kind: task',
      '    action: log',
      'flow:',
      '  - do: ask',
      '  - do: reply',
      '  - do: log',
      'outputs: {}',
    ].join('\n'),
  );
  const actions = {
    await_reply: { workflowTypes: [WorkflowType.conversational] },
    send_text_message: { workflowTypes: [WorkflowType.conversational] },
    // An action without workflow types runs in any workflow.
    log: {},
  };

  it('accepts actions the workflow type can run', () => {
    expect(() =>
      assertTaskActionsSupported(
        definition,
        WorkflowType.conversational,
        actions,
      ),
    ).not.toThrow();
  });

  it('lists every task whose action the workflow type cannot run', () => {
    expect(() =>
      assertTaskActionsSupported(definition, WorkflowType.manual, actions),
    ).toThrow(
      'Actions not available in manual workflows: ' +
        'ask (await_reply), reply (send_text_message)',
    );
  });

  it('leaves actions that are not registered to the definition validation', () => {
    expect(() =>
      assertTaskActionsSupported(definition, WorkflowType.manual, {}),
    ).not.toThrow();
  });
});
