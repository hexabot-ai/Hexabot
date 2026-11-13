/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { JSONSchema7, Output, generateText, jsonSchema } from 'ai';

import { ActionService } from '@/actions/actions.service';
import { ActionMetadata, ExecArgs } from '@/actions/types';
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
      isStepLimitReached,
      logCall,
      model,
      modelId,
      prepareStep,
      promptPayload,
      stepCount,
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
      ...(tools ? { tools } : {}),
      ...(stopWhen ? { stopWhen } : {}),
      ...(prepareStep ? { prepareStep } : {}),
    });
    const stepLimitReached = isStepLimitReached(result);
    const object = this.readObject(result, stepLimitReached, stepCount);
    const reasoning = this.extractReasoning(result);

    return {
      text: result.text,
      object,
      ...(reasoning ? { reasoning } : {}),
      finish_reason: result.finishReason,
      step_limit_reached: stepLimitReached,
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

  /**
   * Reads the generated object. The AI SDK throws when the last step did not
   * finish with an answer; when the step limit caused it, say so.
   */
  private readObject(
    result: { readonly output: unknown },
    stepLimitReached: boolean,
    stepCount?: number,
  ): unknown {
    try {
      return result.output;
    } catch (error) {
      if (!stepLimitReached) {
        throw error;
      }

      throw new Error(
        `The model reached the step limit (${stepCount}) before generating the object. Raise the "stop_step_count" setting of the ${this.name} action.`,
        { cause: error },
      );
    }
  }
}
