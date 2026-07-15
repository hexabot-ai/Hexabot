/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { StepExecutionRecord } from "@hexabot-ai/agentic";

export const getStepOrder = (id: string): number => {
  const [prefix] = id.split(":");
  const order = Number(prefix);

  return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
};

export const getStepDuration = (step: StepExecutionRecord): number => {
  const candidate = (step as StepExecutionRecord & { duration?: number })
    .duration;

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }

  if (
    typeof step.startedAt === "number" &&
    Number.isFinite(step.startedAt) &&
    typeof step.endedAt === "number" &&
    Number.isFinite(step.endedAt)
  ) {
    return Math.max(0, step.endedAt - step.startedAt);
  }

  return 0;
};
