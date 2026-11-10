/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { defineAction } from '../../../src';
import type { AgentExampleContext } from '../context';

const inputSchema = z.strictObject({
  x: z.number(),
});
const outputSchema = z.strictObject({
  formula: z.string(),
  result: z.number(),
});
const settingSchema = z.strictObject({
  bias: z.number().default(0),
  multiplier: z.number().default(1),
});

type CalculateScoreInput = z.infer<typeof inputSchema>;
type CalculateScoreOutput = z.infer<typeof outputSchema>;
type CalculateScoreSettings = z.infer<typeof settingSchema>;

export const calculateScore = defineAction<
  CalculateScoreInput,
  CalculateScoreOutput,
  AgentExampleContext,
  CalculateScoreSettings
>({
  name: 'calculate_score',
  description: 'Calculates a score with score = multiplier * x + bias.',
  inputSchema,
  outputSchema,
  settingSchema,
  execute: async ({ input, settings }) => {
    const result = settings.multiplier * input.x + settings.bias;

    console.log(`[workflow] Calculating score for x=${input.x}`);

    return {
      formula: `${settings.multiplier} * ${input.x} + ${settings.bias}`,
      result,
    };
  },
});
