/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { stepCountIs, tool, ToolLoopAgent, type ToolSet } from 'ai';
import { z } from 'zod';

import { defineAction } from '../../../src';
import type { AgentBindings } from '../bindings';
import type { AgentExampleContext } from '../context';

import { caculateScore } from './caculate-score';

const actionRegistry = {
  caculate_score: caculateScore,
} as const;
const inputSchema = z.strictObject({
  prompt: z.string(),
  system: z.string().optional(),
});
const outputSchema = z.strictObject({
  steps: z.array(z.unknown()).optional(),
  text: z.string(),
  tool_calls: z.array(z.unknown()).optional(),
  tool_results: z.array(z.unknown()).optional(),
});
const settingSchema = z.strictObject({
  api_key: z.string().optional(),
  max_steps: z.int().positive().default(2),
  model: z.string().default('gpt-4o'),
  provider: z.literal('openai').default('openai'),
});

type AiAgentInput = z.infer<typeof inputSchema>;
type AiAgentOutput = z.infer<typeof outputSchema>;
type AiAgentSettings = z.infer<typeof settingSchema>;

const resolveTools = (
  bindings: AgentBindings,
  context: AgentExampleContext,
): ToolSet => {
  const mountedTools = bindings.tools ?? {};
  const tools: ToolSet = {};

  for (const [toolName, toolDefinition] of Object.entries(mountedTools)) {
    const actionName = toolDefinition.action as keyof typeof actionRegistry;
    const action = actionRegistry[actionName];

    if (!action) {
      throw new Error(
        `Unsupported tool action "${String(toolDefinition.action)}" mounted in bindings.tools.${toolName}`,
      );
    }

    tools[toolName] = tool({
      description:
        toolDefinition.description ??
        `Workflow tool "${toolName}" delegates to action "${action.name}".`,
      inputSchema: action.inputSchema,
      execute: async (payload) =>
        action.run(payload, context, toolDefinition.settings as any),
    });
  }

  return tools;
};

export const aiAgent = defineAction<
  AiAgentInput,
  AiAgentOutput,
  AgentExampleContext,
  AiAgentSettings,
  AgentBindings
>({
  name: 'ai_agent',
  description:
    'Runs a Vercel AI SDK ToolLoopAgent and resolves workflow-mounted tools through action bindings.',
  supportedBindings: ['tools'],
  inputSchema,
  outputSchema,
  settingSchema,
  execute: async ({ input, settings, context, bindings }) => {
    const apiKey = settings.api_key ?? process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error(
        'Missing OpenAI API key. Set settings.api_key or OPENAI_API_KEY.',
      );
    }

    const provider = createOpenAI({ apiKey });
    const model = provider(settings.model);
    const tools = resolveTools(bindings, context);
    const agent = new ToolLoopAgent({
      ...(input.system ? { instructions: input.system } : {}),
      model,
      stopWhen: stepCountIs(settings.max_steps),
      tools,
    });
    const result = await agent.generate({ prompt: input.prompt });

    return {
      steps: result.steps,
      text: result.text,
      tool_calls: result.toolCalls,
      tool_results: result.toolResults,
    };
  },
});
