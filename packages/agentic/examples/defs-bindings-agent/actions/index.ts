/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Action } from '../../../src';

import { aiAgent } from './ai-agent';
import { calculateScore } from './calculate-score';

export const defsBindingsActions: Record<string, Action> = {
  ai_agent: aiAgent,
  calculate_score: calculateScore,
};
