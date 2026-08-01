/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  isOpenInferenceSpan,
  OpenInferenceBatchSpanProcessor,
} from '@arizeai/openinference-vercel';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import type { TelemetrySettings } from 'ai';

const AGENTPOND_TRACING_STATE = Symbol.for('hexabot.agentpond-tracing');

interface AgentPondTracingState {
  provider: BasicTracerProvider;
  telemetry: TelemetrySettings;
}

type AgentPondGlobal = typeof globalThis & {
  [AGENTPOND_TRACING_STATE]?: AgentPondTracingState;
};

async function createAgentPondTracingState(): Promise<
  AgentPondTracingState | undefined
> {
  if (!process.env.FILES_SDK_PROVIDER) {
    return undefined;
  }

  try {
    // Keep the native dynamic import: Hexabot compiles to CommonJS while the
    // AgentPond Files SDK adapter is ESM-only.
    const importEsm = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<{
      createFilesSpanExporterFromRuntimeEnv: () => ConstructorParameters<
        typeof OpenInferenceBatchSpanProcessor
      >[0]['exporter'];
    }>;
    const { createFilesSpanExporterFromRuntimeEnv } = await importEsm(
      '@agentpond/files-sdk/otel',
    );
    const provider = new BasicTracerProvider({
      spanProcessors: [
        new OpenInferenceBatchSpanProcessor({
          exporter: createFilesSpanExporterFromRuntimeEnv(),
          spanFilter: isOpenInferenceSpan,
          reparentOrphanedSpans: true,
        }),
      ],
    });

    return {
      provider,
      telemetry: {
        functionId: 'hexabot-ai-action',
        isEnabled: true,
        recordInputs: false,
        recordOutputs: false,
        tracer: provider.getTracer('@hexabot-ai/api'),
      },
    };
  } catch (error) {
    Logger.warn(
      `AgentPond tracing is disabled: ${(error as Error).message}`,
      'AgentPond',
    );

    return undefined;
  }
}

const agentPondGlobal = globalThis as AgentPondGlobal;
let tracingInitialization: Promise<void> | undefined;

export let agentPondTelemetry =
  agentPondGlobal[AGENTPOND_TRACING_STATE]?.telemetry;

export function initializeAgentPondTracing(): Promise<void> {
  if (!tracingInitialization) {
    tracingInitialization = (async () => {
      const tracingState =
        agentPondGlobal[AGENTPOND_TRACING_STATE] ??
        (await createAgentPondTracingState());
      if (tracingState) {
        agentPondGlobal[AGENTPOND_TRACING_STATE] = tracingState;
        agentPondTelemetry = tracingState.telemetry;
      }
    })();
  }

  return tracingInitialization;
}

export async function flushAgentPondTracing(): Promise<void> {
  try {
    await agentPondGlobal[AGENTPOND_TRACING_STATE]?.provider.forceFlush();
  } catch (error) {
    Logger.warn(
      `Failed to flush AgentPond traces: ${(error as Error).message}`,
      'AgentPond',
    );
  }
}

@Injectable()
export class AgentPondTracingLifecycle
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await initializeAgentPondTracing();
  }

  async onModuleDestroy(): Promise<void> {
    const tracingState = agentPondGlobal[AGENTPOND_TRACING_STATE];
    try {
      await tracingState?.provider.shutdown();
    } catch (error) {
      Logger.warn(
        `Failed to shut down AgentPond tracing: ${(error as Error).message}`,
        'AgentPond',
      );
    } finally {
      delete agentPondGlobal[AGENTPOND_TRACING_STATE];
      agentPondTelemetry = undefined;
    }
  }
}
