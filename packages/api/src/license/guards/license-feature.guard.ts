/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { LicenseService } from '../services/license.service';
import {
  LICENSE_FEATURE_LABELS,
  LicenseFeature,
} from '../types/license-feature.enum';

export const LICENSE_FEATURE_METADATA_KEY = 'license:features';

@Injectable()
export class LicenseFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly licenseService: LicenseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeatures = this.reflector.getAllAndOverride<LicenseFeature[]>(
      LICENSE_FEATURE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredFeatures?.length) {
      return true;
    }

    const missingFeatures = requiredFeatures.filter(
      (feature) => !this.licenseService.hasFeature(feature),
    );

    if (!missingFeatures.length) {
      return true;
    }

    const label = missingFeatures
      .map((feature) => LICENSE_FEATURE_LABELS[feature] ?? feature)
      .join(', ');

    throw new ForbiddenException(
      this.licenseService.getLastError() ??
        `Access to ${label} requires an active compatible license.`,
    );
  }
}
