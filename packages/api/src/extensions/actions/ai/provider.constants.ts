/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { isPackageInstalled } from '@/utils/helpers/package-manager';

export const vercelAiSdkProviders = [
  'alibaba',
  'amazon-bedrock',
  'anthropic',
  'assemblyai',
  'azure',
  'baseten',
  'black-forest-labs',
  'bytedance',
  'cerebras',
  'claude',
  'cohere',
  'deepgram',
  'deepinfra',
  'deepseek',
  'elevenlabs',
  'fal',
  'fireworks',
  'gateway',
  'gemini',
  'gladia',
  'google',
  'google-vertex',
  'groq',
  'huggingface',
  'hume',
  'klingai',
  'litellm',
  'lmnt',
  'luma',
  'mistral',
  'moonshotai',
  'open-responses',
  'openai',
  'openai-compatible',
  'perplexity',
  'prodia',
  'replicate',
  'revai',
  'togetherai',
  'vercel',
  'xai',
] as const;

export type VercelAiSdkProvider = (typeof vercelAiSdkProviders)[number];

const providerPackageOverrides: Partial<Record<VercelAiSdkProvider, string>> = {
  claude: 'anthropic',
  gemini: 'google',
  litellm: 'openai-compatible',
};
const toProviderOption = (provider: VercelAiSdkProvider) => {
  const packageName = `@ai-sdk/${providerPackageOverrides[provider] ?? provider}`;

  return {
    provider,
    packageName,
    installed: isPackageInstalled(packageName),
  };
};

export const vercelAiSdkProviderOptions = vercelAiSdkProviders
  .map(toProviderOption)
  .sort((left, right) => Number(right.installed) - Number(left.installed));
