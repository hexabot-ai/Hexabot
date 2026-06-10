/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { ChannelVisibility } from "@hexabot-ai/types";

import { IBaseSchema } from "./base.types";

// @TODO: not all entities extend from IBaseSchema
export interface IChannel extends IBaseSchema {
  name: string;
  settingsSchema?: Record<string, unknown>;
  visibility?: ChannelVisibility;
}
