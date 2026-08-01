/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { generateText } from 'ai';

import { ActionService } from '@/actions/actions.service';
import { ActionMetadata, ExecArgs } from '@/actions/types';
import { agentPondTelemetry } from '@/telemetry/agentpond-tracing';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

import { AiBaseAction, AiPromptInput } from './ai-base.action';
import { AiGenerateTextOutput, AiGenerateTextSettings } from './ai-schemas';

export abstract class AiGenerateTextBaseAction<
  I,
  C extends WorkflowRuntimeContext = WorkflowRuntimeContext,
> extends AiBaseAction<I, AiGenerateTextOutput, C, AiGenerateTextSettings> {
  protected constructor(
    metadata: ActionMetadata<I, AiGenerateTextOutput, AiGenerateTextSettings>,
    actionService: ActionService,
  ) {
    super(metadata, actionService);
  }

  protected abstract resolvePromptInput(input: I): AiPromptInput;

  async execute(args: ExecArgs<I, C, AiGenerateTextSettings>) {
    const { input, signal } = args;
    const {
      callSettings,
      logCall,
      model,
      modelId,
      promptPayload,
      stopWhen,
      tools,
    } = await this.prepareCall(this.resolvePromptInput(input), args);

    logCall();
    const result = await generateText({
      ...promptPayload,
      ...callSettings,
      model,
      abortSignal: signal,
      ...(agentPondTelemetry
        ? { experimental_telemetry: agentPondTelemetry }
        : {}),
      ...(tools ? { tools } : {}),
      ...(stopWhen ? { stopWhen } : {}),
    });
    const reasoning =
      result.reasoningText ??
      (result.reasoning?.length
        ? result.reasoning.map((part) => part.text).join('\n')
        : undefined);

    return {
      text: result.text,
      ...(reasoning ? { reasoning } : {}),
      finish_reason: result.finishReason,
      model: modelId,
      usage: this.normalizeUsage(result.usage),
      raw: {
        request: result.request,
        response: result.response,
        provider_metadata: result.providerMetadata,
        warnings: result.warnings,
      },
    };
  }
}
