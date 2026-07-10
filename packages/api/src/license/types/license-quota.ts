/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type {
  LicensePlan,
  LicenseStatus,
  PaidPlan,
} from './license-feature.enum';

export type LicenseQuotaTier = 'community' | PaidPlan;

export type LicenseQuotaResource = 'users' | 'workflows';

export const LICENSE_QUOTA_RESOURCE_NAMES: Record<
  LicenseQuotaResource,
  string
> = {
  users: 'user',
  workflows: 'workflow',
} as const;

export type LicenseQuotaResourceSnapshot = {
  limit: number | null;
  used: number;
  remaining: number | null;
  reached: boolean;
};

export type LicenseQuotaSnapshot = {
  tier: LicenseQuotaTier;
  resources: Record<LicenseQuotaResource, LicenseQuotaResourceSnapshot>;
};

export const LICENSE_QUOTA_LIMITS: Record<
  LicenseQuotaResource,
  Record<LicenseQuotaTier, number | null>
> = {
  users: {
    community: 1,
    starter: 1,
    pro: 10,
    unlimited: 25,
  },
  workflows: {
    community: 10,
    starter: 25,
    pro: 150,
    unlimited: null,
  },
} as const;

const PAID_QUOTA_TIERS: ReadonlySet<PaidPlan> = new Set([
  'starter',
  'pro',
  'unlimited',
]);

export const resolveLicenseQuotaTier = (
  status: LicenseStatus,
  plan: LicensePlan,
): LicenseQuotaTier => {
  if (status !== 'active') {
    return 'community';
  }

  return PAID_QUOTA_TIERS.has(plan as PaidPlan)
    ? (plan as PaidPlan)
    : 'community';
};
