/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import fs from 'fs';
import path from 'path';

import { Workflow, WorkflowEventEmitter } from '../../src';

import { defsBindingsActions } from './actions';
import { bindingKinds } from './bindings';
import { AgentExampleContext } from './context';

const workflowPath = path.join(__dirname, 'workflow.yml');

async function main() {
  const yamlSource = fs.readFileSync(workflowPath, 'utf8');
  const workflow = Workflow.fromYaml(yamlSource, {
    actions: defsBindingsActions,
    bindingKinds,
  });
  const emitter = new WorkflowEventEmitter();
  const context = new AgentExampleContext(
    {
      request_id: 'request-1',
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
  const result = await runner.start({
    inputData: {},
    context,
  });

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

// OPENAI_API_KEY=... pnpm dlx ts-node packages/agentic/examples/defs-bindings-agent/workflow.ts
void main();
