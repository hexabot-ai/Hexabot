/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MockLanguageModelV3 } from 'ai/test';

import { ActionService } from '@/actions/actions.service';
import type { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

const PROMPT_SENTINEL = 'agentpond-private-prompt';
const RESPONSE_SENTINEL = 'agentpond-private-response';
const originalEnvironment = {
  projectId: process.env.AGENTPOND_PROJECT_ID,
  provider: process.env.FILES_SDK_PROVIDER,
  root: process.env.FILES_SDK_ROOT,
};
const configuredRoot = process.env.AGENTPOND_E2E_ROOT;
let traceRoot: string;

function restoreEnvironment(): void {
  for (const [name, value] of Object.entries({
    AGENTPOND_PROJECT_ID: originalEnvironment.projectId,
    FILES_SDK_PROVIDER: originalEnvironment.provider,
    FILES_SDK_ROOT: originalEnvironment.root,
  })) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

beforeAll(async () => {
  traceRoot =
    configuredRoot ?? (await mkdtemp(join(tmpdir(), 'hexabot-agentpond-')));
  process.env.AGENTPOND_PROJECT_ID = 'default-project';
  process.env.FILES_SDK_PROVIDER = 'fs';
  process.env.FILES_SDK_ROOT = traceRoot;
  jest.resetModules();
});

afterAll(async () => {
  restoreEnvironment();
  if (!configuredRoot) {
    await rm(traceRoot, { force: true, recursive: true });
  }
});

describe('AgentPond AI action tracing', () => {
  it('reads back a content-free trace from the production generate-text action', async () => {
    const [{ AiGenerateTextAction }, tracingModule] = await Promise.all([
      import('../src/extensions/actions/ai/generate-text.action'),
      import('../src/telemetry/agentpond-tracing'),
    ]);
    const { AgentPondTracingLifecycle, flushAgentPondTracing } = tracingModule;
    const lifecycle = new AgentPondTracingLifecycle();
    await lifecycle.onModuleInit();
    const actionService = { register: jest.fn() } as unknown as ActionService;
    const action = new AiGenerateTextAction(actionService);
    const model = new MockLanguageModelV3({
      provider: 'hexabot-agentpond-e2e',
      modelId: 'hexabot-agentpond-test-model',
      doGenerate: {
        content: [{ type: 'text', text: RESPONSE_SENTINEL }],
        finishReason: { raw: 'stop', unified: 'stop' },
        usage: {
          inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 7, total: 7 },
          outputTokens: { reasoning: 0, text: 4, total: 4 },
        },
        warnings: [],
      },
    });
    const provider = Object.assign(
      jest.fn(() => model),
      {
        languageModel: jest.fn(() => model),
      },
    );
    jest.spyOn(action as any, 'loadProvider').mockResolvedValue(provider);

    const context = {
      services: {
        actions: { get: jest.fn() },
        credentials: { findOneValue: jest.fn().mockResolvedValue('fixture') },
        logger: { debug: jest.fn() },
      },
    } as unknown as WorkflowRuntimeContext;
    const result = await action.execute({
      input: { prompt: PROMPT_SENTINEL, system: 'fixture system prompt' },
      settings: {
        retries: {
          backoff_ms: 25,
          jitter: 0,
          max_attempts: 1,
          max_delay_ms: 25,
          multiplier: 1,
        },
        timeout_ms: 0,
      },
      context,
      bindings: {
        model: {
          settings: {
            model_id: 'hexabot-agentpond-test-model',
            provider: 'fixture',
          },
        },
      },
    } as any);

    expect(result.text).toBe(RESPONSE_SENTINEL);
    expect(result.usage?.total_tokens).toBe(11);
    await flushAgentPondTracing();

    const traceKeys = (await readdir(traceRoot, { recursive: true })).filter(
      (key) => key.endsWith('.json') && !key.endsWith('.meta.json'),
    );
    expect(traceKeys).not.toHaveLength(0);
    const rawTraces = await Promise.all(
      traceKeys.map((key) => readFile(join(traceRoot, key), 'utf8')),
    );
    const rawTracePayload = rawTraces.join('\n');

    expect(rawTracePayload).toContain('hexabot-agentpond-test-model');
    expect(rawTracePayload).toContain('llm.token_count.total');
    expect(rawTracePayload).not.toContain(PROMPT_SENTINEL);
    expect(rawTracePayload).not.toContain(RESPONSE_SENTINEL);
    await lifecycle.onModuleDestroy();

    const replacementLifecycle = new AgentPondTracingLifecycle();
    await replacementLifecycle.onModuleInit();
    expect(tracingModule.agentPondTelemetry).toBeDefined();
    await replacementLifecycle.onModuleDestroy();
  });
});
