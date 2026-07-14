/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { parseWorkflowDefinition } from './workflow-definition';

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
