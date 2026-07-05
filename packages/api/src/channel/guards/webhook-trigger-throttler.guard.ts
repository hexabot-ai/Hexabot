/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

/**
 * Rate-limits the public webhook trigger endpoint. Requests are tracked per
 * caller IP and workflow so one noisy integration cannot exhaust the budget
 * of every workflow reachable from the same IP, while brute-force attempts
 * against a single workflow stay capped. `req.ip` honours the Express
 * `trust proxy` setting driven by `config.security.trustProxy`.
 */
@Injectable()
export class WebhookTriggerThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    return `${req.ip}:${req.params?.id}`;
  }
}
