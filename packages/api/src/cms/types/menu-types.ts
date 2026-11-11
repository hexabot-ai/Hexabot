/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { MenuStub, Menu } from '@hexabot-ai/types';

import {
  NestedMenuAttrs,
  PostbackMenuAttrs,
  WebUrlMenuAttrs,
  WithMenuAttrs,
} from './menu';

export type NestedMenuDtoAttrs = NestedMenuAttrs;

export type PostbackMenuDtoAttrs = PostbackMenuAttrs;

export type WebUrlMenuDtoAttrs = WebUrlMenuAttrs;

export type AnyMenuDto<T extends MenuStub = Menu> = WithMenuAttrs<T>;

export type MenuTreeDto = (AnyMenuDto<Menu> & {
  call_to_actions?: MenuTreeDto;
})[];
