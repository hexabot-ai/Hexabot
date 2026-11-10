/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { MenuType } from "@hexabot-ai/types";

import { IBaseSchema } from "./base.types";

export interface IMenuNodeStub extends IBaseSchema {
  type: MenuType;
  url?: string | null;
  title: string;
  payload?: string | null;
  parent?: string | null;
}

export interface IMenuNode extends IMenuNodeStub {
  call_to_actions?: string[];
}

export interface IMenuNodeFull extends IMenuNodeStub {
  call_to_actions?: IMenuNode[];
}
