/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { MenuOrmEntity, MenuType } from '../entities/menu.entity';

interface MenuAttrs {
  type: MenuType;
  payload?: unknown;
  url?: unknown;
}

export interface NestedMenuAttrs {
  type: MenuType.nested;
  payload?: never;
  url?: never;
}

export interface PostbackMenuAttrs {
  type: MenuType.postback;
  payload: string;
  url?: never;
}

export interface WebUrlMenuAttrs {
  type: MenuType.web_url;
  payload?: never;
  url: string;
}

type AnyMenuAttrs = NestedMenuAttrs | PostbackMenuAttrs | WebUrlMenuAttrs;

/** `T` with the attributes its menu `type` requires. */
export type WithMenuAttrs<T> = Omit<T, keyof MenuAttrs> & AnyMenuAttrs;

export type AnyMenu<T extends MenuOrmEntity = MenuOrmEntity> = WithMenuAttrs<T>;

export type MenuTree = (AnyMenu<MenuOrmEntity> & {
  call_to_actions?: MenuTree;
})[];
