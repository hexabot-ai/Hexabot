/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Setting } from '@hexabot-ai/types';

export { FieldType } from '@hexabot-ai/types';

export type AnySetting = Setting;

export type ExtensionSetting<
  E extends object = object,
  U extends AnySetting = AnySetting,
  K extends keyof Setting = 'id' | 'createdAt' | 'updatedAt',
> = Omit<U, K> & E;
