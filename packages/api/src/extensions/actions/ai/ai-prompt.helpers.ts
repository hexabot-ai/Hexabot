/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  IncomingMessageType,
  Message,
  StdIncomingMessage,
  StdOutgoingMessage,
  Thread,
} from '@hexabot-ai/types';
import { ModelMessage } from 'ai';

import { RuntimeBindings } from '@/bindings/runtime-bindings';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

import {
  AiPromptInput,
  DEFAULT_AI_MESSAGES_LIMIT,
  DEFAULT_AI_PROMPT,
} from './ai-schemas';

/**
 * Shared prompt + working-memory builders used by every AI-flavored action
 * (`ai_agent`, `generate_*`, and the sandboxed `ai_coding_agent`) so they build
 * the model request from a direct prompt or conversation history, and inject
 * selected memory, in exactly the same way. `AiBaseAction` delegates to these;
 * actions that do not extend it (the coding agent runs on a different engine)
 * import them directly.
 */

export type PromptPayload =
  | { prompt: string; system?: string }
  | { messages: ModelMessage[]; system?: string };

export function resolveMessageContent(
  payload: StdOutgoingMessage | StdIncomingMessage,
): string | undefined {
  if (!payload) {
    return undefined;
  }

  const data = payload.data as Record<string, unknown>;

  if (typeof data.text === 'string') {
    return data.text;
  }

  if (typeof data.serializedText === 'string') {
    return data.serializedText;
  }

  if (
    payload.type === IncomingMessageType.location &&
    typeof data.coordinates === 'object' &&
    data.coordinates !== null &&
    'lat' in data.coordinates &&
    'lon' in data.coordinates
  ) {
    const { lat, lon } = data.coordinates as { lat: number; lon: number };

    return `location:${lat},${lon}`;
  }

  try {
    return JSON.stringify(data);
  } catch {
    return String(payload);
  }
}

export function normalizeMessagesForModel(
  messages: Message[],
  subscriberId: string,
): ModelMessage[] {
  type ConversationMessage = {
    role: Extract<ModelMessage['role'], 'user' | 'assistant'>;
    content: string;
    createdAt: Date;
  };

  const normalized: ConversationMessage[] = messages
    .map((message) => {
      const content = resolveMessageContent(message.message);

      if (!content) {
        return undefined;
      }

      const role: ConversationMessage['role'] =
        message.sender === subscriberId ? 'user' : 'assistant';

      return {
        role,
        content,
        createdAt: message.createdAt,
      };
    })
    .filter((message): message is ConversationMessage => Boolean(message));

  return normalized
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(({ role, content }) => ({ role, content }));
}

export function formatMemoryValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value === null) {
    return 'null';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function buildMemoryPrompt(
  context: WorkflowRuntimeContext,
  selectedMemorySlugs: string[] = [],
): string | undefined {
  if (selectedMemorySlugs.length === 0) {
    return undefined;
  }

  const memoryStore = context.memoryStore;
  if (!memoryStore) {
    return undefined;
  }

  const { definitionCache, instances } = memoryStore;
  if (!definitionCache || definitionCache.size === 0) {
    return undefined;
  }

  const sections: string[] = [];
  const selectedSlugSet = new Set(selectedMemorySlugs);
  for (const [slug, definition] of definitionCache.entries()) {
    if (!selectedSlugSet.has(slug)) {
      continue;
    }

    const instance = instances[slug];
    if (!instance) {
      continue;
    }

    const lines: string[] = [];
    for (const field of instance.fields({ includeAdditional: true })) {
      if (field.value === undefined) {
        continue;
      }

      const label = (field.title ?? field.name).trim();
      const value = formatMemoryValue(field.value);
      lines.push(`- ${label}: ${value}`);
    }

    if (lines.length === 0) {
      continue;
    }

    sections.push(`## ${definition.name}\n${lines.join('\n')}`);
  }

  if (sections.length === 0) {
    return undefined;
  }

  return `# Working Memory\n${sections.join('\n\n')}`;
}

export function resolveMemoryBindingSlugs(
  context: WorkflowRuntimeContext,
  memoryBindings?: RuntimeBindings['memory'],
): string[] {
  if (!memoryBindings || Object.keys(memoryBindings).length === 0) {
    return [];
  }

  const memoryStore = context.memoryStore;
  if (!memoryStore) {
    return [];
  }

  const idToSlug = new Map<string, string>();
  for (const [slug, definition] of memoryStore.definitionCache.entries()) {
    if (definition.id) {
      idToSlug.set(definition.id, slug);
    }
  }

  const selectedSlugs = new Set<string>();
  for (const [defName, binding] of Object.entries(memoryBindings)) {
    const definitionId = binding.settings?.definition_id;
    const slug =
      typeof definitionId === 'string' ? idToSlug.get(definitionId) : undefined;
    if (!slug) {
      throw new Error(
        `Unable to resolve memory definition "${String(definitionId)}" from bindings.memory.${defName}.settings.definition_id.`,
      );
    }

    selectedSlugs.add(slug);
  }

  return Array.from(selectedSlugs);
}

/**
 * Merge an optional working-memory section into the system prompt so selected
 * memory is presented consistently regardless of the action's input mode.
 */
export function mergeMemoryIntoSystem(
  context: WorkflowRuntimeContext,
  system: string | undefined,
  selectedMemorySlugs: string[] = [],
): string | undefined {
  const memoryPrompt = buildMemoryPrompt(context, selectedMemorySlugs);
  if (!memoryPrompt) {
    return system;
  }

  return system ? `${system}\n\n${memoryPrompt}` : memoryPrompt;
}

export async function buildPrompt(
  input: AiPromptInput,
  context: WorkflowRuntimeContext,
  selectedMemorySlugs: string[] = [],
): Promise<PromptPayload> {
  const system = mergeMemoryIntoSystem(
    context,
    input.system,
    selectedMemorySlugs,
  );

  if (input.input_mode === 'prompt') {
    const prompt = input.prompt ?? DEFAULT_AI_PROMPT;

    return { prompt, system };
  }

  if (input.input_mode === 'history') {
    const messagesLimit = input.messages_limit ?? DEFAULT_AI_MESSAGES_LIMIT;

    if (messagesLimit < 1) {
      throw new Error(
        'Input mode "history" requires a positive "messages_limit" value.',
      );
    }

    const subscriberId = context.initiatorId;
    if (!subscriberId) {
      throw new Error(
        'A subscriber id is required to load previous messages for this action.',
      );
    }
    const threadId = context.threadId;
    if (!threadId) {
      throw new Error(
        'A thread id is required to load previous messages for this action.',
      );
    }

    const messageService = context.services.message;
    if (!messageService) {
      throw new Error(
        'Message service is unavailable in the workflow context.',
      );
    }

    const history = await messageService.findLastMessages(
      { id: threadId } as Thread,
      messagesLimit,
    );
    const messages = normalizeMessagesForModel(history, subscriberId);

    return { messages, system };
  }

  throw new Error(
    'An "input_mode" of either "prompt" or "history" is required to build the model request.',
  );
}
