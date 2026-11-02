/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import type { InferWorkflowBindings } from '../../src';

export const bindingKinds = {
  tools: {
    schema: z.record(z.string(), z.unknown()),
    multiple: true as const,
    actionPolicy: 'required' as const,
    supportedBindings: ['tools'],
  },
};

export type AgentBindings = InferWorkflowBindings<typeof bindingKinds>;
