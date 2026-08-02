/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { JSONSchema7, Output, generateText, jsonSchema } from 'ai';

import { ActionService } from '@/actions/actions.service';
import { ActionMetadata, ExecArgs } from '@/actions/types';
import { agentPondTelemetry } from '@/telemetry/agentpond-tracing';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

import { AiBaseAction, AiPromptInput } from './ai-base.action';
import { AiGenerateObjectOutput, AiGenerateObjectSettings } from './ai-schemas';

export abstract class AiGenerateObjectBaseAction<
  I,
  C extends WorkflowRuntimeContext = WorkflowRuntimeContext,
> extends AiBaseAction<I, AiGenerateObjectOutput, C, AiGenerateObjectSettings> {
  protected constructor(
    metadata: ActionMetadata<
      I,
      AiGenerateObjectOutput,
      AiGenerateObjectSettings
    >,
    actionService: ActionService,
  ) {
    super(metadata, actionService);
  }

  protected abstract resolvePromptInput(input: I): AiPromptInput;

  async execute(args: ExecArgs<I, C, AiGenerateObjectSettings>) {
    const { input, settings, signal } = args;
    const {
      callSettings,
      logCall,
      model,
      modelId,
      promptPayload,
      stopWhen,
      tools,
    } = await this.prepareCall(this.resolvePromptInput(input), args);
    // Structured outputs do not support stop sequences in the AI SDK call.
    const { stopSequences: _stopSequences, ...callSettingsWithoutStops } =
      callSettings;
    const outputSchema = settings.output_schema as JSONSchema7;
    const output = Output.object({
      schema: jsonSchema(outputSchema),
      name: outputSchema.title,
      description: outputSchema.description,
    });

    logCall();
    const result = await generateText({
      ...promptPayload,
      ...callSettingsWithoutStops,
      model,
      output,
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
      object: result.output,
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
