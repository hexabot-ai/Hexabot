/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { validate } from 'class-validator';

import { IsWorkflowDefinition } from './is-workflow-definition.decorator';

class TestDto {
  @IsWorkflowDefinition()
  definition: unknown;
}

const validateDefinition = async (definition: unknown) => {
  const dto = new TestDto();

  dto.definition = definition;

  return await validate(dto);
};

describe('IsWorkflowDefinition', () => {
  it('accepts a valid workflow definition', async () => {
    const errors = await validateDefinition({
      defs: {
        greet: {
          kind: 'task',
          action: 'greet_action',
        },
      },
      flow: [{ do: 'greet' }],
      outputs: { result: '=true' },
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects non-object values with a dedicated message', async () => {
    const errors = await validateDefinition('not an object');

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isWorkflowDefinition).toBe(
      'Workflow definition must be an object',
    );
  });

  it('reports messages derived from the structured validation issues', async () => {
    const errors = await validateDefinition({
      defs: {
        greet: {
          kind: 'task',
          action: 'greet_action',
        },
      },
      flow: [{ do: 'ghost_task' }],
      outputs: { result: '=true' },
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isWorkflowDefinition).toBe(
      'Invalid workflow definition: Unknown task(s) referenced in flow: ghost_task',
    );
  });
});
