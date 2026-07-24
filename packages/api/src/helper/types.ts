/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { AnySetting, ExtensionSetting } from '@/setting/types';

import BaseHelper from './lib/base-helper';
import { BaseRagHelper } from './lib/base-rag-helper';
import { BaseStorageHelper } from './lib/base-storage-helper';

export enum HelperType {
  STORAGE = 'storage',
  RAG = 'rag',
  UTIL = 'util',
}

export type HelperName = string;

interface HelperTypeMap {
  [HelperType.STORAGE]: BaseStorageHelper<HelperName>;
  [HelperType.RAG]: BaseRagHelper<HelperName>;
  [HelperType.UTIL]: BaseHelper;
}

export type TypeOfHelper<T extends HelperType> = HelperTypeMap[T];

export type HelperRegistry<H extends BaseHelper = BaseHelper> = Map<
  HelperType,
  Map<string, H>
>;

export type HelperSetting<N extends HelperName = HelperName> = ExtensionSetting<
  {
    group: N;
  },
  AnySetting,
  'id' | 'createdAt' | 'updatedAt' | 'group'
>;
