/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from 'zod';

import { isRecord } from './utils/clone';

// Per-action timeout in milliseconds; 0 disables the timeout wrapper.
export const DEFAULT_TIMEOUT_MS = 0;

// Retry defaults: disabled with 3 attempts and exponential backoff starting at 25ms, capped at 10s, no jitter.
export const DEFAULT_RETRY_SETTINGS = {
  enabled: false,
  max_attempts: 3,
  backoff_ms: 25,
  max_delay_ms: 10_000,
  jitter: 0,
  multiplier: 1,
} as const;

// Retry policy: exponential backoff per attempt, capped by max_delay_ms, with optional jitter multiplier.
const RetriesSchema = z.strictObject({
  enabled: z.boolean().optional().meta({
    title: 'Enabled',
    description:
      'Enable retry attempts when an action fails (disabled = no retries).',
  }),
  max_attempts: z
    .int()
    .min(1)
    .default(DEFAULT_RETRY_SETTINGS.max_attempts)
    .meta({
      title: 'Max Attempts',
      description: 'Total number of attempts before giving up.',
    }),
  backoff_ms: z.int().min(0).default(DEFAULT_RETRY_SETTINGS.backoff_ms).meta({
    title: 'Initial Backoff (ms)',
    description: 'Delay in milliseconds before the first retry.',
  }),
  max_delay_ms: z
    .int()
    .min(0)
    .default(DEFAULT_RETRY_SETTINGS.max_delay_ms)
    .meta({
      title: 'Max Delay (ms)',
      description: 'Maximum delay cap in milliseconds between retries.',
    }),
  jitter: z.number().min(0).default(DEFAULT_RETRY_SETTINGS.jitter).meta({
    title: 'Jitter',
    description: 'Randomization factor applied to retry delays (0 = none).',
  }),
  multiplier: z
    .number()
    .min(1)
    .default(DEFAULT_RETRY_SETTINGS.multiplier)
    .meta({
      title: 'Backoff Multiplier',
      description: 'Multiplier applied to the delay after each retry.',
    }),
});

// Shared execution settings applied to every action invocation.
export const BaseSettingsSchema = z.strictObject({
  timeout_ms: z.int().nonnegative().optional().meta({
    title: 'Timeout (ms)',
    description:
      'Maximum runtime in milliseconds for a single action invocation (0 = disabled).',
  }),
  retries: RetriesSchema.optional().meta({
    title: 'Retries',
    description: 'Retry policy applied when an action fails.',
  }),
});

const EXECUTION_SETTING_KEYS = new Set(Object.keys(BaseSettingsSchema.shape));

/**
 * Split the settings handed to an action the way `AbstractAction.run` reads
 * them: the execution settings every action takes (`BaseSettingsSchema`),
 * and the action's own settings.
 *
 * @param settings Settings of a task, or of a def that names an action.
 * @returns Both parts; empty when the settings are not an object.
 */
export const splitExecutionSettings = (
  settings: unknown,
): { execution: Record<string, unknown>; own: Record<string, unknown> } => {
  const entries = isRecord(settings) ? Object.entries(settings) : [];

  // `fromEntries` defines own keys, so a `__proto__` key stays a key.
  return {
    execution: Object.fromEntries(
      entries.filter(([key]) => EXECUTION_SETTING_KEYS.has(key)),
    ),
    own: Object.fromEntries(
      entries.filter(([key]) => !EXECUTION_SETTING_KEYS.has(key)),
    ),
  };
};
