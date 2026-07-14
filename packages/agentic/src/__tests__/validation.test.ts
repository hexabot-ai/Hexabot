/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { validateWorkflow } from '../dsl.types';
import { issueMessages } from '../validation-issue';

import { mergeTaskDefs } from './test-helpers';

const fixturePath = path.join(
  __dirname,
  '..',
  '..',
  'examples',
  'full',
  'workflow.yml',
);
const fixtureYaml = fs.readFileSync(fixturePath, 'utf8');
const bindingKinds = {
  tools: {
    schema: z.record(z.string(), z.unknown()),
    multiple: true,
    actionPolicy: 'required' as const,
  },
  toolset: {
    schema: z.strictObject({
      name: z.string(),
    }),
    multiple: true,
  },
  model: {
    schema: z.strictObject({
      provider: z.string(),
      model: z.string(),
    }),
    multiple: false,
  },
};

describe('validateWorkflow', () => {
  it('accepts the reference workflow example', () => {
    const result = validateWorkflow(fixtureYaml, { bindingKinds });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(Object.keys(result.data.defs)).toContain('understand_request');
      expect(result.data.flow.length).toBeGreaterThan(0);
      expect(result.data.outputs).toHaveProperty('delivered');
    }
  });

  it('accepts loop steps with an empty body', () => {
    const parsed = parseYaml(fixtureYaml) as Record<string, unknown>;
    parsed.flow = [
      {
        loop: {
          type: 'for_each',
          for_each: {
            item: 'item',
            in: '=[]',
          },
          steps: [],
        },
      },
    ];

    const result = validateWorkflow(parsed, { bindingKinds });

    expect(result.success).toBe(true);
  });

  it('accepts while loop steps with an empty body', () => {
    const parsed = parseYaml(fixtureYaml) as Record<string, unknown>;
    parsed.flow = [
      {
        loop: {
          type: 'while',
          while: '=true',
          steps: [],
        },
      },
    ];

    const result = validateWorkflow(parsed, { bindingKinds });

    expect(result.success).toBe(true);
  });

  it('fails while loop steps when max_concurrency is provided', () => {
    const parsed = parseYaml(fixtureYaml) as Record<string, unknown>;
    parsed.flow = [
      {
        loop: {
          type: 'while',
          while: '=true',
          max_concurrency: 4,
          steps: [],
        },
      },
    ];

    const result = validateWorkflow(parsed, { bindingKinds });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it('fails loop schema validation when loop.type is missing', () => {
    const parsed = parseYaml(fixtureYaml) as Record<string, unknown>;
    parsed.flow = [
      {
        loop: {
          for_each: {
            item: 'item',
            in: '=[]',
          },
          steps: [],
        },
      },
    ];
    const result = validateWorkflow(parsed, { bindingKinds });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it('fails while loops when the while condition is missing', () => {
    const parsed = parseYaml(fixtureYaml) as Record<string, unknown>;
    parsed.flow = [
      {
        loop: {
          type: 'while',
          steps: [],
        },
      },
    ];

    const result = validateWorkflow(parsed, { bindingKinds });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it('accepts parallel steps with an empty body', () => {
    const parsed = parseYaml(fixtureYaml) as Record<string, unknown>;
    parsed.flow = [
      {
        parallel: {
          steps: [],
        },
      },
    ];

    const result = validateWorkflow(parsed, { bindingKinds });

    expect(result.success).toBe(true);
  });

  it('fails when flow references unknown tasks', () => {
    const parsed = parseYaml(fixtureYaml) as Record<string, unknown>;
    parsed.flow = [{ do: 'non_existent_task' }];

    const result = validateWorkflow(parsed, { bindingKinds });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0].message).toMatch(/non_existent_task/);
    }
  });

  it('fails schema validation when expressions are malformed', () => {
    const parsed = parseYaml(fixtureYaml) as Record<string, unknown>;
    parsed.flow = [
      {
        conditional: {
          when: [
            {
              condition: 'missing-equals-prefix',
              steps: [{ do: 'understand_request' }],
            },
          ],
        },
      },
    ];

    const result = validateWorkflow(parsed, { bindingKinds });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.issues.some((issue) =>
          issue.message.includes('Expression strings'),
        ),
      ).toBe(true);
    }
  });

  it('accepts defs and task bindings when all refs and kinds are valid', () => {
    const workflow = {
      defs: mergeTaskDefs(
        {
          agent_step: {
            action: 'understand_request_action',
            bindings: {
              tools: ['calculate'],
            },
          },
        },
        {
          calculate: {
            kind: 'tools',
            action: 'calculate_score',
            settings: { multiplier: 2 },
          },
        },
      ),
      flow: [{ do: 'agent_step' }],
      outputs: { result: '=$output.agent_step' },
    };
    const result = validateWorkflow(workflow, { bindingKinds });

    expect(result.success).toBe(true);
  });

  it('accepts single-ref task bindings for kinds with multiple=false', () => {
    const workflow = {
      defs: mergeTaskDefs(
        {
          agent_step: {
            action: 'understand_request_action',
            bindings: {
              model: 'chat_model',
            },
          },
        },
        {
          chat_model: {
            kind: 'model',
            settings: {
              provider: 'openai',
              model: 'gpt-4o-mini',
            },
          },
        },
      ),
      flow: [{ do: 'agent_step' }],
      outputs: { result: '=$output.agent_step' },
    };
    const result = validateWorkflow(workflow, { bindingKinds });

    expect(result.success).toBe(true);
  });

  it('fails when single-ref binding kinds are provided as arrays', () => {
    const workflow = {
      defs: mergeTaskDefs(
        {
          agent_step: {
            action: 'understand_request_action',
            bindings: {
              model: ['chat_model'],
            },
          },
        },
        {
          chat_model: {
            kind: 'model',
            settings: {
              provider: 'openai',
              model: 'gpt-4o-mini',
            },
          },
        },
      ),
      flow: [{ do: 'agent_step' }],
      outputs: { result: '=$output.agent_step' },
    };
    const result = validateWorkflow(workflow, { bindingKinds });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.issues.some((issue) =>
          issue.message.includes(
            'Expected a single def reference string for binding kind "model"',
          ),
        ),
      ).toBe(true);
    }
  });

  it('fails when multi-ref binding kinds are provided as strings', () => {
    const workflow = {
      defs: mergeTaskDefs(
        {
          agent_step: {
            action: 'understand_request_action',
            bindings: {
              tools: 'calculate',
            },
          },
        },
        {
          calculate: {
            kind: 'tools',
            action: 'calculate_score',
            settings: {},
          },
        },
      ),
      flow: [{ do: 'agent_step' }],
      outputs: { result: '=$output.agent_step' },
    };
    const result = validateWorkflow(workflow, { bindingKinds });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.issues.some((issue) =>
          issue.message.includes(
            'Expected an array of def references for binding kind "tools"',
          ),
        ),
      ).toBe(true);
    }
  });

  it('fails when task bindings reference unknown defs', () => {
    const workflow = {
      defs: mergeTaskDefs(
        {
          agent_step: {
            action: 'understand_request_action',
            bindings: {
              tools: ['missing_tool'],
            },
          },
        },
        {},
      ),
      flow: [{ do: 'agent_step' }],
      outputs: { result: '=$output.agent_step' },
    };
    const result = validateWorkflow(workflow, { bindingKinds });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.issues.some((issue) => issue.message.includes('missing_tool')),
      ).toBe(true);
    }
  });

  it('fails when a task binding references a def with a different kind', () => {
    const workflow = {
      defs: mergeTaskDefs(
        {
          agent_step: {
            action: 'understand_request_action',
            bindings: {
              tools: ['calculator_pack'],
            },
          },
        },
        {
          calculator_pack: {
            kind: 'toolset',
            settings: { name: 'calc' },
          },
        },
      ),
      flow: [{ do: 'agent_step' }],
      outputs: { result: '=$output.agent_step' },
    };
    const result = validateWorkflow(workflow, { bindingKinds });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.issues.some((issue) =>
          issue.message.includes('cannot be mounted as'),
        ),
      ).toBe(true);
    }
  });

  it('fails when defs declare undeclared kinds', () => {
    const workflow = {
      defs: mergeTaskDefs(
        {
          agent_step: {
            action: 'understand_request_action',
          },
        },
        {
          remote_server: {
            kind: 'mcp_server',
            settings: {
              endpoint: 'http://localhost:3000',
            },
          },
        },
      ),
      flow: [{ do: 'agent_step' }],
      outputs: { result: '=$output.agent_step' },
    };
    const result = validateWorkflow(workflow, { bindingKinds });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.issues.some((issue) =>
          issue.message.includes('Unknown binding kind'),
        ),
      ).toBe(true);
    }
  });

  it('fails when task bindings use undeclared kinds', () => {
    const workflow = {
      defs: mergeTaskDefs(
        {
          agent_step: {
            action: 'understand_request_action',
            bindings: {
              mcp_server: ['calculate'],
            },
          },
        },
        {
          calculate: {
            kind: 'tools',
            action: 'calculate_score',
            settings: {},
          },
        },
      ),
      flow: [{ do: 'agent_step' }],
      outputs: { result: '=$output.agent_step' },
    };
    const result = validateWorkflow(workflow, { bindingKinds });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.issues.some((issue) =>
          issue.message.includes('defs.agent_step.bindings.mcp_server'),
        ),
      ).toBe(true);
    }
  });

  it('fails when defs or bindings are present without bindingKinds', () => {
    const workflow = {
      defs: mergeTaskDefs(
        {
          agent_step: {
            action: 'understand_request_action',
            bindings: {
              tools: ['calculate'],
            },
          },
        },
        {
          calculate: {
            kind: 'tools',
            action: 'calculate_score',
            settings: {},
          },
        },
      ),
      flow: [{ do: 'agent_step' }],
      outputs: { result: '=$output.agent_step' },
    };
    const result = validateWorkflow(workflow);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.issues.some((issue) => issue.message.includes('bindingKinds')),
      ).toBe(true);
    }
  });

  it('fails when task bindings include duplicate refs', () => {
    const workflow = {
      defs: mergeTaskDefs(
        {
          agent_step: {
            action: 'understand_request_action',
            bindings: {
              tools: ['calculate', 'calculate'],
            },
          },
        },
        {
          calculate: {
            kind: 'tools',
            action: 'calculate_score',
            settings: {},
          },
        },
      ),
      flow: [{ do: 'agent_step' }],
      outputs: { result: '=$output.agent_step' },
    };
    const result = validateWorkflow(workflow, { bindingKinds });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.issues.some((issue) =>
          issue.message.includes('Duplicate def reference'),
        ),
      ).toBe(true);
    }
  });

  describe('structured issues', () => {
    it('reports missing required action inputs and settings', () => {
      const workflow = {
        defs: mergeTaskDefs({
          send_message_task: {
            action: 'send_message',
          },
        }),
        flow: [{ do: 'send_message_task' }],
        outputs: { result: '=$output.send_message_task' },
      };
      const result = validateWorkflow(workflow, {
        bindingKinds,
        actions: {
          send_message: {
            inputSchema: z.strictObject({ recipient: z.string() }),
            settingSchema: z.strictObject({ channel: z.string() }),
          },
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: 'action_inputs',
              path: ['defs', 'send_message_task', 'inputs', 'recipient'],
              actionName: 'send_message',
              taskId: 'send_message_task',
            }),
            expect.objectContaining({
              code: 'action_settings',
              path: ['defs', 'send_message_task', 'settings', 'channel'],
              actionName: 'send_message',
              taskId: 'send_message_task',
            }),
          ]),
        );
      }
    });

    it('merges workflow defaults before validating action settings', () => {
      const workflow = {
        defaults: {
          settings: {
            delivery: { channel: 'sms' },
          },
        },
        defs: mergeTaskDefs({
          send_message_task: {
            action: 'send_message',
            settings: { delivery: { region: 'eu' } },
          },
        }),
        flow: [{ do: 'send_message_task' }],
        outputs: { result: '=$output.send_message_task' },
      };
      const result = validateWorkflow(workflow, {
        bindingKinds,
        actions: {
          send_message: {
            inputSchema: z.strictObject({}),
            settingSchema: z.strictObject({
              delivery: z.strictObject({
                channel: z.string(),
                region: z.string(),
              }),
            }),
          },
        },
      });

      expect(result.success).toBe(true);
    });

    it('defers action schema type checks for JSONata expressions', () => {
      const workflow = {
        defs: mergeTaskDefs({
          retry_task: {
            action: 'retry_action',
            inputs: { retry_count: '=$input.retries' },
            settings: { threshold: '=$context.threshold' },
          },
        }),
        flow: [{ do: 'retry_task' }],
        outputs: { result: '=$output.retry_task' },
      };
      const result = validateWorkflow(workflow, {
        bindingKinds,
        actions: {
          retry_action: {
            inputSchema: z.strictObject({ retry_count: z.number() }),
            settingSchema: z.strictObject({ threshold: z.number() }),
          },
        },
      });

      expect(result.success).toBe(true);
    });

    it('reports missing actions with code, actionName and path', () => {
      const workflow = {
        defs: mergeTaskDefs({
          agent_step: {
            action: 'not_installed_action',
          },
        }),
        flow: [{ do: 'agent_step' }],
        outputs: { result: '=$output.agent_step' },
      };
      const result = validateWorkflow(workflow, {
        bindingKinds,
        actions: {},
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues).toEqual([
          {
            code: 'missing_action',
            message:
              'defs.agent_step.action: No action implementation provided for "not_installed_action".',
            path: ['defs', 'agent_step', 'action'],
            actionName: 'not_installed_action',
          },
        ]);
      }
    });

    it('reports unknown task references per task with paths', () => {
      const parsed = parseYaml(fixtureYaml) as Record<string, unknown>;
      parsed.flow = [
        { do: 'non_existent_task' },
        { parallel: { steps: [{ do: 'other_missing_task' }] } },
        { do: 'non_existent_task' },
      ];

      const result = validateWorkflow(parsed, { bindingKinds });

      expect(result.success).toBe(false);
      if (!result.success) {
        const unknownTasks = result.issues.filter(
          (issue) => issue.code === 'unknown_task',
        );

        expect(unknownTasks).toEqual([
          {
            code: 'unknown_task',
            message: 'Unknown task(s) referenced in flow: non_existent_task',
            path: ['flow', 0, 'do'],
            taskId: 'non_existent_task',
          },
          {
            code: 'unknown_task',
            message: 'Unknown task(s) referenced in flow: other_missing_task',
            path: ['flow', 1, 'parallel', 'steps', 0, 'do'],
            taskId: 'other_missing_task',
          },
        ]);
      }
    });

    it('reports schema issues with the zod path', () => {
      const parsed = parseYaml(fixtureYaml) as Record<string, unknown>;
      parsed.flow = [
        {
          loop: {
            type: 'while',
            steps: [],
          },
        },
      ];

      const result = validateWorkflow(parsed, { bindingKinds });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.issues.every((issue) => issue.code === 'schema')).toBe(
          true,
        );
        expect(result.issues[0].path?.[0]).toBe('flow');
      }
    });

    it('derives flat human-readable messages via issueMessages', () => {
      const workflow = {
        defs: mergeTaskDefs({
          agent_step: {
            action: 'not_installed_action',
          },
        }),
        flow: [{ do: 'agent_step' }, { do: 'ghost_task' }],
        outputs: { result: '=$output.agent_step' },
      };
      const result = validateWorkflow(workflow, {
        bindingKinds,
        actions: {},
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(issueMessages(result.issues)).toEqual([
          'Unknown task(s) referenced in flow: ghost_task',
          'defs.agent_step.action: No action implementation provided for "not_installed_action".',
        ]);
      }
    });
  });
});
