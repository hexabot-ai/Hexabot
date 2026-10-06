/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import fs from 'fs';
import path from 'path';

import { Workflow, WorkflowEventEmitter } from '../../src';

import { loopExampleActions } from './actions';
import { LoopExampleContext } from './context';

const workflowPath = path.join(__dirname, 'workflow.yml');

async function main() {
  const yamlSource = fs.readFileSync(workflowPath, 'utf8');
  const workflow = Workflow.fromYaml(yamlSource, {
    actions: loopExampleActions,
  });
  const emitter = new WorkflowEventEmitter();
  const context = new LoopExampleContext({ channel: 'chat' }, emitter);

  emitter.on('hook:workflow:start', () => context.log('workflow started'));
  emitter.on('hook:workflow:suspended', ({ waits }) =>
    waits.forEach(({ step, reason }) =>
      context.log(`workflow suspended at "${step.name}"`, { reason }),
    ),
  );
  emitter.on('hook:workflow:finish', ({ output }) =>
    context.log('workflow finished', output),
  );

  const runner = await workflow.buildAsyncRunner();
  let result = await runner.start({
    inputData: {},
    context,
  });
  const simulatedReplies = ['12', '12345678'];
  let attempt = 0;

  while (result.status === 'suspended') {
    const nextReply =
      simulatedReplies[Math.min(attempt, simulatedReplies.length - 1)];
    attempt += 1;

    if (!nextReply) {
      throw new Error('No simulated reply available for resuming the workflow');
    }

    context.log('resuming with simulated reply', { text: nextReply });
    result = await runner.resume({
      resumeData: { text: nextReply },
    });
  }

  if (result.status === 'finished') {
    console.log('Final workflow outputs:', result.output);

    return;
  }

  console.error('Workflow failed:', result.error);
}

// pnpm dlx ts-node packages/agentic/examples/loop/workflow.ts
void main();
