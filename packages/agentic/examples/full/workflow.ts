/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import fs from 'fs';
import path from 'path';

import { Workflow, WorkflowEventEmitter } from '../../src';

import { exampleActions } from './actions';
import { ExampleContext } from './context';

const workflowPath = path.join(__dirname, 'workflow.yml');

async function main() {
  const yamlSource = fs.readFileSync(workflowPath, 'utf8');
  const workflow = Workflow.fromYaml(yamlSource, {
    actions: exampleActions,
  });
  const emitter = new WorkflowEventEmitter();
  const context = new ExampleContext(
    {
      user_id: 'user-123',
      account_tier: 'pro',
      locale: 'en-US',
      timezone: 'America/Los_Angeles',
      channel: 'email',
      thread_id: 'thread-123',
      full_transcript: 'Conversation so far with the user.',
      last_summary: 'Previous summary of the issue.',
      support_playbook: 'Support runbook v1.2',
      product_brief: 'Launch messaging and positioning.',
    },
    emitter,
  );
  emitter.on('hook:step:start', ({ step }) =>
    context.log(`hook:step:start:${step.name}`),
  );
  emitter.on('hook:step:success', ({ step }) =>
    context.log(`hook:step:success:${step.name}`),
  );
  emitter.on('hook:workflow:finish', ({ output }) =>
    context.log('hook:workflow:finish', output),
  );
  const runner = await workflow.buildAsyncRunner();
  const inputData = {
    query: 'We are seeing API errors after deploying billing changes.',
    user_email: 'customer@example.com',
    priority: 'normal',
    attachments: [],
  };
  const result = await runner.start({ inputData, context });

  if (result.status === 'finished') {
    console.log('Final workflow outputs:', result.output);

    return;
  }

  if (result.status === 'suspended') {
    const [wait] = result.waits;
    console.log(
      `Workflow suspended at step ${wait.step.id} for reason "${wait.reason}"`,
      wait.data,
    );

    return;
  }

  console.error('Workflow failed:', result.error);
}

// pnpm dlx ts-node packages/agentic/examples/full/workflow.ts
void main();
