/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Injectable } from '@nestjs/common';
import { ToolLoopAgent } from 'ai';

import { ExecArgs } from '@/actions';
import { ActionService } from '@/actions/actions.service';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

import { AiBaseAction } from './ai-base.action';
import {
  AiAgentInput,
  AiAgentOutput,
  AiAgentSettings,
  aiAgentInputSchema,
  aiAgentOutputSchema,
  aiAgentSettingsSchema,
} from './ai-schemas';

@Injectable()
export class AiAgentAction extends AiBaseAction<
  AiAgentInput,
  AiAgentOutput,
  WorkflowRuntimeContext,
  AiAgentSettings
> {
  constructor(actionService: ActionService) {
    super(
      {
        name: 'ai_agent',
        description:
          'Runs a ToolLoopAgent with optional tools to generate multi-step outputs via the Vercel AI SDK.',
        inputSchema: aiAgentInputSchema,
        outputSchema: aiAgentOutputSchema,
        settingsSchema: aiAgentSettingsSchema,
      },
      actionService,
    );
  }

  async execute(
    args: ExecArgs<AiAgentInput, WorkflowRuntimeContext, AiAgentSettings>,
  ) {
    const { input, signal } = args;
    const {
      callSettings,
      isStepLimitReached,
      logCall,
      model,
      modelId,
      prepareStep,
      promptPayload,
      stopWhen,
      tools,
    } = await this.prepareCall(input, args);
    const agent = new ToolLoopAgent({
      ...callSettings,
      ...(promptPayload.system ? { instructions: promptPayload.system } : {}),
      ...(stopWhen ? { stopWhen } : {}),
      ...(prepareStep ? { prepareStep } : {}),
      model,
      tools,
    });

    logCall();
    const agentPrompt =
      'messages' in promptPayload
        ? promptPayload.messages
        : promptPayload.prompt;

    if (!agentPrompt) {
      throw new Error('Prompt is required to call the agent.');
    }

    const result = await agent.generate({
      prompt: agentPrompt,
      abortSignal: signal,
    });

    return {
      text: result.text,
      content: result.content,
      reasoning: this.extractReasoning(result),
      files: result.files,
      sources: result.sources,
      tool_calls: result.steps.flatMap((step) => step.toolCalls),
      tool_results: result.steps.flatMap((step) => step.toolResults),
      finish_reason: result.finishReason,
      raw_finish_reason: result.rawFinishReason,
      step_limit_reached: isStepLimitReached(result),
      model: modelId,
      usage: this.normalizeUsage(result.usage),
      total_usage: this.normalizeUsage(result.totalUsage),
      steps: result.steps,
      raw: {
        request: result.request,
        response: result.response,
        provider_metadata: result.providerMetadata,
        warnings: result.warnings,
      },
    };
  }
}

export default AiAgentAction;
