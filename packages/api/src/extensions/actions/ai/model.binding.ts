/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { BindingKindDescriptor } from '@hexabot-ai/agentic';
import z from 'zod';

import { createBindingKind } from '@/bindings/create-binding-kind';
import { getAddPackageCommand } from '@/utils/helpers/package-manager';

import { vercelAiSdkProviderOptions } from './provider.constants';

export { vercelAiSdkProviders } from './provider.constants';

const providerNames = vercelAiSdkProviderOptions.map(
  ({ provider }) => provider,
);
const providerUiOptions = {
  enumNames: vercelAiSdkProviderOptions.map(
    ({ provider, packageName, installed }) =>
      installed
        ? provider
        : `${provider} (${getAddPackageCommand(packageName)})`,
  ),
  enumDisabled: vercelAiSdkProviderOptions
    .filter(({ installed }) => !installed)
    .map(({ provider }) => provider),
};

export const aiModelBindingSchema = z.strictObject({
  provider: z.enum(providerNames).default('openai').meta({
    title: 'Provider',
    description:
      'Installed providers are listed first. Disabled providers require the package shown.',
    'ui:options': providerUiOptions,
  }),
  model_id: z.string().min(1).default('gpt-5.2').meta({
    title: 'Model',
    description: 'Provider model identifier to use for generation.',
  }),
  api_key: z
    .string()
    .optional()
    .meta({
      title: 'Credential',
      description: 'Provider API key override for this action.',
      'ui:widget': 'AutoCompleteWidget',
      'ui:options': {
        entity: 'Credential',
        valueKey: 'id',
        labelKey: 'name',
        enableEntityAddButton: true,
      },
    }),
  base_url: z
    .url()
    .optional()
    .meta({
      title: 'Base URL',
      description: 'Custom provider base URL (self-hosted or proxy).',
      'ui:options': {
        showWhen: {
          field: 'provider',
          in: ['gateway', 'litellm', 'openai-compatible'],
        },
      },
    }),
  organization: z
    .string()
    .optional()
    .meta({
      title: 'Organization',
      description: 'Provider organization or account identifier.',
      'ui:options': {
        hideUntilAdded: true,
      },
    }),
  supports_structured_outputs: z
    .boolean()
    .optional()
    .meta({
      title: 'Supports Structured Outputs',
      description:
        'Enable for endpoints that support response_format: json_schema. This sends the full JSON schema for structured generation. Leave unset to preserve the provider default.',
      'ui:options': {
        showWhen: {
          field: 'provider',
          in: ['gateway', 'litellm', 'openai-compatible'],
        },
        hideUntilAdded: true,
      },
    }),
});

declare global {
  interface RuntimeBindingKindRegistry {
    model: BindingKindDescriptor<typeof aiModelBindingSchema, false>;
  }
}

export const ModelBindingKind = createBindingKind({
  kind: 'model',
  schema: aiModelBindingSchema,
  multiple: false,
  color: '#ad46fc',
  icon: 'Brain',
});

export default ModelBindingKind;
