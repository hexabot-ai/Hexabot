/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import z from 'zod';

import { createSettingGroup } from '@/setting/create-setting-group';
import { RuntimeSettingGroupSchema } from '@/setting/runtime-settings';

export const GLOBAL_SETTINGS_GROUP = 'global_settings' as const;

export const RAG_SETTINGS_GROUP = 'rag_settings' as const;

export const CONTACT_SETTINGS_GROUP = 'contact' as const;

export const globalSettingsSchema = z
  .strictObject({
    license_key: z.string().default('').meta({
      title: 'License key',
      description:
        'Provide the license key associated with your subscription. Learn more about available plans at https://hexabot.ai/pricing#pricing.',
      'ui:widget': 'password',
    }),
    default_storage_helper: z
      .string()
      .default('local-storage')
      .meta({
        title: 'Default storage helper',
        description: 'Helper used to persist workflow data by default.',
        'ui:widget': 'AutoCompleteWidget',
        'ui:options': {
          entity: 'StorageHelper',
          valueKey: 'name',
          labelKey: 'name',
        },
      }),
    default_rag_helper: z
      .string()
      .default('fulltext-search')
      .meta({
        title: 'Default RAG helper',
        description:
          'Helper used to retrieve knowledge base content for RAG queries.',
        'ui:widget': 'AutoCompleteWidget',
        'ui:options': {
          entity: 'RagHelper',
          valueKey: 'name',
          labelKey: 'name',
        },
      }),
  })
  .meta({
    title: 'Global settings',
  });

export const ragSettingsSchema = z
  .strictObject({
    top_k: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(3)
      .meta({
        title: 'Top K results',
        description:
          'Maximum number of retrieved content hits returned per query.',
        'ui:options': {
          step: 1,
        },
      }),
  })
  .meta({
    title: 'RAG',
  });

export const contactSettingsSchema = z
  .strictObject({
    contact_email_recipient: z.string().default('admin@example.com').meta({
      title: 'Contact recipient email',
      description: 'Email address that receives contact form submissions.',
    }),
    company_name: z.string().default('Your company name').meta({
      title: 'Company name',
      description: 'Company name displayed to end users.',
    }),
    company_phone: z.string().default('(+999) 9999 9999 999').meta({
      title: 'Company phone',
      description: 'Primary phone number displayed in contact information.',
    }),
    company_email: z.string().default('contact[at]mycompany.com').meta({
      title: 'Company email',
      description: 'Public contact email address shown to users.',
    }),
    company_address1: z.string().default('71 Pilgrim Avenue').meta({
      title: 'Address line 1',
      description: 'First line of the company postal address.',
    }),
    company_address2: z.string().default('').meta({
      title: 'Address line 2',
      description: 'Second line of the company postal address.',
    }),
    company_city: z.string().default('Chevy Chase').meta({
      title: 'City',
      description: 'City for the company postal address.',
    }),
    company_zipcode: z.string().default('85705').meta({
      title: 'Postal code',
      description: 'Postal or ZIP code for the company address.',
    }),
    company_state: z.string().default('Orlando').meta({
      title: 'State or region',
      description: 'State, region, or province for the company address.',
    }),
    company_country: z.string().default('US').meta({
      title: 'Country',
      description: 'Country code for the company address.',
    }),
  })
  .meta({
    title: 'Contact',
  });

declare global {
  interface RuntimeSettingRegistry {
    [GLOBAL_SETTINGS_GROUP]: typeof globalSettingsSchema;
    [RAG_SETTINGS_GROUP]: typeof ragSettingsSchema;
    [CONTACT_SETTINGS_GROUP]: typeof contactSettingsSchema;
  }
}

export const GlobalSettingsGroup = createSettingGroup({
  group: GLOBAL_SETTINGS_GROUP,
  schema: globalSettingsSchema,
  scope: 'global',
});

export const RagSettingsGroup = createSettingGroup({
  group: RAG_SETTINGS_GROUP,
  schema: ragSettingsSchema,
  scope: 'global',
});

export const ContactSettingsGroup = createSettingGroup({
  group: CONTACT_SETTINGS_GROUP,
  schema: contactSettingsSchema,
  scope: 'global',
});

export const DEFAULT_GLOBAL_SETTING_SCHEMAS = [
  {
    group: GLOBAL_SETTINGS_GROUP,
    schema: globalSettingsSchema,
  },
  {
    group: RAG_SETTINGS_GROUP,
    schema: ragSettingsSchema,
  },
  {
    group: CONTACT_SETTINGS_GROUP,
    schema: contactSettingsSchema,
  },
] as const satisfies {
  group: string;
  schema: RuntimeSettingGroupSchema;
}[];
