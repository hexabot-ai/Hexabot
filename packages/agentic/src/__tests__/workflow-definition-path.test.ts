/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { FlowStep, WorkflowDefinition } from '../dsl.types';
import { Workflow, type FlowStepPath } from '../workflow';

import { createTaskDefs } from './test-helpers';

const createDefinition = (): WorkflowDefinition => ({
  defs: createTaskDefs({
    task_one: { action: 'noop' },
    task_two: { action: 'noop' },
    task_three: { action: 'noop' },
    task_four: { action: 'noop' },
    task_five: { action: 'noop' },
    task_six: { action: 'noop' },
  }),
  flow: [
    { do: 'task_one' },
    { parallel: { steps: [{ do: 'task_two' }, { do: 'task_three' }] } },
    {
      conditional: {
        when: [
          { condition: '=true', steps: [{ do: 'task_four' }] },
          { else: true, steps: [{ do: 'task_five' }] },
        ],
      },
    },
  ],
  outputs: { done: '=true' },
});
const getParallelSteps = (definition: WorkflowDefinition) =>
  (definition.flow[1] as { parallel: { steps: FlowStep[] } }).parallel.steps;

describe('workflow definition path helpers', () => {
  describe('getValueAtPath', () => {
    it('returns nested values for object and array paths', () => {
      const definition = createDefinition();
      const path: FlowStepPath = ['flow', 1, 'parallel', 'steps', 0, 'do'];

      expect(Workflow.getValueAtPath(definition, path)).toBe('task_two');
    });

    it('returns the root value for an empty path', () => {
      const definition = createDefinition();

      expect(Workflow.getValueAtPath(definition, [])).toBe(definition);
    });

    it('returns undefined for invalid array keys or nullish branches', () => {
      const definition = createDefinition();

      expect(
        Workflow.getValueAtPath(definition, ['flow', '1']),
      ).toBeUndefined();
      expect(
        Workflow.getValueAtPath({ flow: null }, ['flow', 0]),
      ).toBeUndefined();
    });

    it('stringifies object keys when walking paths', () => {
      const value = { 0: { label: 'zero' } };

      expect(Workflow.getValueAtPath(value, [0, 'label'])).toBe('zero');
    });
  });

  describe('setValueAtPath', () => {
    it('updates nested object values immutably', () => {
      const definition = createDefinition();
      const updated = Workflow.setValueAtPath(
        definition,
        ['defs', 'task_one', 'action'],
        'updated_action',
      );

      expect(updated).not.toBe(definition);
      expect(updated.defs.task_one.action).toBe('updated_action');
      expect(updated.flow).toBe(definition.flow);
    });

    it('updates array elements immutably', () => {
      const steps: FlowStep[] = [{ do: 'task_one' }, { do: 'task_two' }];
      const updated = Workflow.setValueAtPath(steps, [1, 'do'], 'task_three');

      expect(updated).not.toBe(steps);
      expect((updated as FlowStep[])[1]).toEqual({ do: 'task_three' });
      expect(steps[1]).toEqual({ do: 'task_two' });
    });

    it('returns the original value for invalid array keys or non-objects', () => {
      const steps: FlowStep[] = [{ do: 'task_one' }];
      const unchanged = Workflow.setValueAtPath(steps, ['0'], {
        do: 'task_two',
      });

      expect(unchanged).toBe(steps);
      expect(Workflow.setValueAtPath('value', ['next'], 'updated')).toBe(
        'value',
      );
    });
  });

  describe('removeStepAtPath', () => {
    it('removes a step at the provided path', () => {
      const definition = createDefinition();
      const updated = Workflow.removeStepAtPath(definition, ['flow', 1]);

      expect(updated).not.toBeNull();
      const nextDefinition = updated as WorkflowDefinition;

      expect(nextDefinition.flow).toHaveLength(2);
      expect(nextDefinition.flow[1]).toEqual(definition.flow[2]);
      expect(nextDefinition.defs.task_two).toEqual({
        kind: 'task',
        action: 'noop',
      });
      expect(nextDefinition.defs.task_three).toEqual({
        kind: 'task',
        action: 'noop',
      });
      expect(definition.flow).toHaveLength(3);
    });

    it('removes a nested step in a parallel block', () => {
      const definition = createDefinition();
      const updated = Workflow.removeStepAtPath(definition, [
        'flow',
        1,
        'parallel',
        'steps',
        0,
      ]);

      expect(updated).not.toBeNull();
      const nextDefinition = updated as WorkflowDefinition;
      const steps = getParallelSteps(nextDefinition);

      expect(steps).toHaveLength(1);
      expect(steps[0]).toEqual({ do: 'task_three' });
      expect(nextDefinition.defs.task_two).toBeUndefined();
      expect(nextDefinition.defs.task_three).toEqual({
        kind: 'task',
        action: 'noop',
      });
    });

    it('removes an unreferenced task definition when deleting a task step', () => {
      const definition = createDefinition();
      const updated = Workflow.removeStepAtPath(definition, ['flow', 0]);

      expect(updated).not.toBeNull();
      const nextDefinition = updated as WorkflowDefinition;

      expect(nextDefinition.defs.task_one).toBeUndefined();
      expect(nextDefinition.flow).toEqual(definition.flow.slice(1));
    });

    it('keeps task definitions that are still referenced by other steps', () => {
      const definition = createDefinition();
      const definitionWithDuplicateTask: WorkflowDefinition = {
        ...definition,
        flow: [...definition.flow, { do: 'task_one' }],
      };
      const updated = Workflow.removeStepAtPath(definitionWithDuplicateTask, [
        'flow',
        0,
      ]);

      expect(updated).not.toBeNull();
      const nextDefinition = updated as WorkflowDefinition;

      expect(nextDefinition.defs.task_one).toEqual({
        kind: 'task',
        action: 'noop',
      });
      expect(nextDefinition.flow).toEqual([
        ...definition.flow.slice(1),
        { do: 'task_one' },
      ]);
    });

    it('returns null for invalid paths', () => {
      const definition = createDefinition();

      expect(Workflow.removeStepAtPath(definition, [])).toBeNull();
      expect(Workflow.removeStepAtPath(definition, ['flow', '1'])).toBeNull();
      expect(
        Workflow.removeStepAtPath(definition, ['defs', 'task_one', 0]),
      ).toBeNull();
      expect(Workflow.removeStepAtPath(definition, ['flow', 99])).toBeNull();
      expect(Workflow.removeStepAtPath(definition, ['flow', 3])).toBeNull();
      expect(Workflow.removeStepAtPath(definition, ['flow', -1])).toBeNull();
    });
  });

  describe('insertStepAtPath', () => {
    it('inserts a step at the provided path', () => {
      const definition = createDefinition();
      const step: FlowStep = { do: 'task_six' };
      const updated = Workflow.insertStepAtPath(definition, ['flow', 1], step);

      expect(updated).not.toBeNull();
      const nextDefinition = updated as WorkflowDefinition;

      expect(nextDefinition.flow).toHaveLength(4);
      expect(nextDefinition.flow[1]).toEqual(step);
      expect(definition.flow).toHaveLength(3);
    });

    it('clamps insertion indices to array bounds', () => {
      const definition = createDefinition();
      const step: FlowStep = { do: 'task_six' };
      const insertAtStart = Workflow.insertStepAtPath(
        definition,
        ['flow', -2],
        step,
      );
      const insertAtEnd = Workflow.insertStepAtPath(
        definition,
        ['flow', 99],
        step,
      );

      expect(insertAtStart).not.toBeNull();
      expect((insertAtStart as WorkflowDefinition).flow[0]).toEqual(step);

      expect(insertAtEnd).not.toBeNull();
      const endDefinition = insertAtEnd as WorkflowDefinition;
      expect(endDefinition.flow[endDefinition.flow.length - 1]).toEqual(step);
    });

    it('inserts a step into a nested array', () => {
      const definition = createDefinition();
      const step: FlowStep = { do: 'task_six' };
      const updated = Workflow.insertStepAtPath(
        definition,
        ['flow', 1, 'parallel', 'steps', 1],
        step,
      );

      expect(updated).not.toBeNull();
      const nextDefinition = updated as WorkflowDefinition;
      const steps = getParallelSteps(nextDefinition);

      expect(steps).toEqual([{ do: 'task_two' }, step, { do: 'task_three' }]);
    });

    it('returns null for invalid paths', () => {
      const definition = createDefinition();
      const step: FlowStep = { do: 'task_six' };

      expect(Workflow.insertStepAtPath(definition, [], step)).toBeNull();
      expect(
        Workflow.insertStepAtPath(definition, ['flow', '1'], step),
      ).toBeNull();
      expect(
        Workflow.insertStepAtPath(definition, ['defs', 'task_one', 0], step),
      ).toBeNull();
    });
  });

  describe('safeRenameTaskInDefinition', () => {
    it('renames a task and updates flow and output references', () => {
      const baseDefinition = createDefinition();
      const definition: WorkflowDefinition = {
        ...baseDefinition,
        defs: {
          ...baseDefinition.defs,
          task_two: {
            kind: 'task',
            action: 'noop',
            inputs: {
              from_dot: '=$output.task_one.value',
              from_single: "=$output['task_one']",
              from_double: '=$output["task_one"]',
              untouched: '=$output.task_one_extra.value',
            },
          },
        },
        flow: [
          { do: 'task_one' },
          {
            conditional: {
              when: [
                { condition: '=true', steps: [{ do: 'task_one' }] },
                {
                  else: true,
                  steps: [
                    {
                      loop: {
                        type: 'for_each',
                        for_each: {
                          item: 'item',
                          in: '=[]',
                        },
                        steps: [{ do: 'task_one' }],
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
        outputs: {
          dot: '=$output.task_one.value',
          single: "=$output['task_one'].value",
          double: '=$output["task_one"].value',
          untouched: '=$output.task_one_extra.value',
        },
      };
      const nextDefinition = Workflow.safeRenameTaskInDefinition(
        definition,
        'task_one',
        'renamed_task',
      );

      expect(nextDefinition.defs.task_one).toBeUndefined();
      expect(nextDefinition.defs.renamed_task).toEqual({
        kind: 'task',
        action: 'noop',
      });
      expect(nextDefinition.flow).toEqual([
        { do: 'renamed_task' },
        {
          conditional: {
            when: [
              { condition: '=true', steps: [{ do: 'renamed_task' }] },
              {
                else: true,
                steps: [
                  {
                    loop: {
                      type: 'for_each',
                      for_each: {
                        item: 'item',
                        in: '=[]',
                      },
                      steps: [{ do: 'renamed_task' }],
                    },
                  },
                ],
              },
            ],
          },
        },
      ]);
      expect(
        (nextDefinition.defs.task_two as { inputs?: unknown }).inputs,
      ).toEqual({
        from_dot: '=$output.renamed_task.value',
        from_single: "=$output['renamed_task']",
        from_double: '=$output["renamed_task"]',
        untouched: '=$output.task_one_extra.value',
      });
      expect(nextDefinition.outputs).toEqual({
        dot: '=$output.renamed_task.value',
        single: "=$output['renamed_task'].value",
        double: '=$output["renamed_task"].value',
        untouched: '=$output.task_one_extra.value',
      });
    });

    it('returns the original definition when rename is a no-op', () => {
      const definition = createDefinition();

      expect(
        Workflow.safeRenameTaskInDefinition(definition, 'task_one', 'task_one'),
      ).toBe(definition);
      expect(
        Workflow.safeRenameTaskInDefinition(
          definition,
          'missing_task',
          'renamed_task',
        ),
      ).toBe(definition);
    });
  });
});
