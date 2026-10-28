/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { LoggerService } from '@/logger/logger.service';

/**
 * Start work that its caller does not wait for, such as the pass of a run a
 * request claimed, so that the request answers before the run goes on.
 *
 * The work starts right away, before this returns. Work on a claimed run must
 * never wait behind other work: its claim is only renewed inside
 * `WorkflowRunService.withHeldClaim`, and a claim left unrenewed lapses after
 * `WORKFLOW_RUN_CLAIM_TTL`, after which recovery takes the run over.
 *
 * @param logger - Logger the errors of the work are reported to.
 * @param work - The work.
 * @param message - Message logged when the work throws.
 * @param details - Details logged along with the error.
 * @returns The result of the work, or `undefined` once its error was logged:
 * the promise never rejects.
 */
export const runInBackground = async <T>(
  logger: LoggerService,
  work: () => Promise<T>,
  message: string,
  details: Record<string, unknown> = {},
): Promise<T | undefined> => {
  try {
    return await work();
  } catch (error) {
    logger.error(message, error, details);

    return undefined;
  }
};
