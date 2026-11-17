/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { ActionService } from '@/actions/actions.service';
import { createAction } from '@/actions/create-action';
import { ActionName } from '@/actions/types';

const anyObjectSchema = z.looseObject({});

/**
 * Register, under each name, an action that takes any inputs and settings
 * and does nothing, for specs that save workflow definitions using these
 * actions: saving a version checks its tasks against the registered actions,
 * as compiling it does.
 *
 * @param actionService The action service the saving service reads.
 * @param names The action names the saved definitions use.
 */
export const registerNoopActions = (
  actionService: ActionService,
  names: readonly string[],
): void => {
  for (const name of names) {
    const NoopAction = createAction({
      name: name as ActionName,
      description: `No-op "${name}" action for tests`,
      inputSchema: anyObjectSchema,
      outputSchema: anyObjectSchema,
      settingsSchema: anyObjectSchema,
      execute: () => ({}),
    });

    actionService.register(new NoopAction(actionService));
  }
};
