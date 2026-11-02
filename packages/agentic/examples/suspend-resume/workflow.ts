/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import fs from 'fs';
import path from 'path';

import { Workflow, WorkflowEventEmitter } from '../../src';

import { suspendResumeActions } from './actions';
import { SuspendResumeContext } from './context';

const workflowPath = path.join(__dirname, 'workflow.yml');

async function main() {
  const yamlSource = fs.readFileSync(workflowPath, 'utf8');
  const workflow = Workflow.fromYaml(yamlSource, {
    actions: suspendResumeActions,
  });
  const emitter = new WorkflowEventEmitter();
  const context = new SuspendResumeContext({ channel: 'chat' }, emitter);

  emitter.on('hook:workflow:start', () => context.log('workflow started'));
  emitter.on('hook:workflow:suspended', ({ waits }) =>
    waits.forEach(({ step, reason, data }) =>
      context.log(`workflow suspended at "${step.name}"`, { reason, data }),
    ),
  );
  emitter.on('hook:workflow:finish', ({ output }) =>
    context.log('workflow finished', output),
  );

  const runner = await workflow.buildAsyncRunner();
  // The run below suspends; the `runner` instance is dropped after that.
  const startResult = await runner.start({
    inputData: {
      question: "Can we deploy to production after today's smoke tests?",
    },
    context,
  });

  if (startResult.status === 'finished') {
    context.log('finished without suspending', startResult.output);

    return;
  }

  if (startResult.status === 'failed') {
    console.error('Workflow failed', startResult.error);

    return;
  }

  // Persist the checkpoint and snapshot; they are plain JSON.
  const stored = JSON.stringify({
    checkpoint: startResult.checkpoint,
    snapshot: startResult.snapshot,
  });
  const [wait] = startResult.waits;
  context.log('persisted checkpoint; waiting on', {
    waitId: wait.waitId,
    reason: wait.reason,
  });

  // Later, possibly in another process: check the checkpoint still fits this
  // workflow and the wait accepts the payload, then restore a fresh runner
  // and resolve the wait.
  const { checkpoint, snapshot } = JSON.parse(stored);
  const resumeData = { reply: 'Yes, proceed once monitoring is green.' };
  const validation = workflow.validateCheckpoint(checkpoint, {
    waitId: wait.waitId,
    resumeData,
  });
  if (!validation.ok) {
    console.error('Cannot resume this run', validation.error);

    return;
  }

  const restoredContext = new SuspendResumeContext(
    { channel: 'chat' },
    emitter,
  );
  const restored = workflow.buildRunnerFromCheckpoint({
    checkpoint,
    snapshot,
    context: restoredContext,
  });
  const resumeResult = await restored.resume({
    waitId: wait.waitId,
    resumeData,
  });

  if (resumeResult.status === 'finished') {
    restoredContext.log('resumed and completed', resumeResult.output);

    return;
  }

  if (resumeResult.status === 'suspended') {
    // A refused payload leaves the run as it was: the wait is still open.
    if (resumeResult.rejection) {
      restoredContext.log('payload refused', resumeResult.rejection.error);

      return;
    }

    restoredContext.log('suspended again', resumeResult.waits);

    return;
  }

  console.error('Workflow failed after resume', resumeResult.error);
}

// pnpm dlx ts-node packages/agentic/examples/suspend-resume/workflow.ts
void main();
