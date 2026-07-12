/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Injectable } from '@nestjs/common';
import { ToolLoopAgent, ToolSet } from 'ai';

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

  async execute({
    input,
    settings,
    context,
    bindings,
    signal,
  }: ExecArgs<AiAgentInput, WorkflowRuntimeContext, AiAgentSettings>) {
    const logger = context.services.logger;
    const modelBinding = bindings.model;
    const providerName = modelBinding?.settings?.provider ?? 'openai';
    const modelId = this.resolveModelId(modelBinding);
    const credentials = await context.services.credentials.findOneValue(
      modelBinding?.settings?.api_key,
    );
    const providerOptions = this.buildProviderInitOptions(
      providerName,
      modelBinding,
      credentials,
    );
    const provider = await this.loadProvider(providerName, providerOptions);
    const model = this.createModel(provider, modelId);
    const selectedMemorySlugs = this.resolveMemoryBindingSlugs(
      context,
      bindings.memory,
    );
    const promptPayload = await this.buildPrompt(
      input,
      context,
      selectedMemorySlugs,
    );
    const callSettings = this.buildCallSettings(settings);
    const tools = (await this.buildTools(
      context,
      bindings.tools,
      bindings.mcp,
      selectedMemorySlugs,
      signal,
    )) as ToolSet | undefined;
    const toolNames = [
      ...Object.keys(bindings.tools ?? {}),
      ...Object.keys(bindings.mcp ?? {}),
    ];
    const { stopWhen, stepCount, toolCall } = this.buildStopWhen(
      settings,
      tools,
    );
    const agent = new ToolLoopAgent({
      ...callSettings,
      ...(promptPayload.system ? { instructions: promptPayload.system } : {}),
      ...(stopWhen ? { stopWhen } : {}),
      model,
      tools,
    });

    logger.debug(
      `Calling model "${modelId}" via ai_agent action using provider "${providerName}"`,
      {
        provider: providerName,
        base_url: providerOptions.baseURL,
        tools: toolNames,
        stop_when: {
          step_count: stepCount,
          tool_call: toolCall,
        },
      },
    );
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
      reasoning:
        result.reasoningText ??
        (result.reasoning?.length
          ? result.reasoning.map((part) => part.text).join('\n')
          : undefined),
      files: result.files,
      sources: result.sources,
      tool_calls: result.toolCalls,
      tool_results: result.toolResults,
      finish_reason: result.finishReason,
      raw_finish_reason: result.rawFinishReason,
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
