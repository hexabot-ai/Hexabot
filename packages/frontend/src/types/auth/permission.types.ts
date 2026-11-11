/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Action, Role } from "@hexabot-ai/types";

import type { EntityType } from "@/services/types";

export interface IUserPermissions {
  roles: Role[];
  permissions: Array<{
    action: Action;
    model: EntityType;
    relation: string;
  }>;
}
