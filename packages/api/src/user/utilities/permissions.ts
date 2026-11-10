/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from '../types/action.type';
import { TModel } from '../types/model.type';
import { PermissionsTree } from '../types/permission.type';

/**
 * Tells whether one of the roles is allowed to perform an action on a model.
 *
 * @param permissions - The permissions tree, keyed by role id.
 * @param roleIds - The ids of the roles to check.
 * @param model - The model.
 * @param action - The action.
 */
export const rolesCanPerform = (
  permissions: PermissionsTree,
  roleIds: string[],
  model: TModel,
  action: Action,
): boolean =>
  Object.entries(permissions)
    .filter(([roleId]) => roleIds.includes(roleId))
    .some(([, modelPermissions]) => modelPermissions[model]?.includes(action));
