/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ILicense,
  LicenseQuotaResource,
  LicenseQuotaTier,
  PaidLicensePlan,
} from "@/types/user.types";

type LicenseQuotas = ILicense["quotas"];
export type LicenseQuotaResourceState =
  LicenseQuotas["resources"][LicenseQuotaResource];

const QUOTA_UPGRADE_TARGET_BY_RESOURCE: Record<
  LicenseQuotaResource,
  Record<LicenseQuotaTier, PaidLicensePlan | null>
> = {
  users: {
    community: "pro",
    starter: "pro",
    pro: "unlimited",
    unlimited: null,
  },
  workflows: {
    community: "starter",
    starter: "pro",
    pro: "unlimited",
    unlimited: null,
  },
};

export const getLicenseQuotaResource = (
  license: ILicense | undefined,
  resource: LicenseQuotaResource,
): LicenseQuotaResourceState | undefined =>
  license?.quotas?.resources?.[resource];

export const isLicenseQuotaReached = (
  license: ILicense | undefined,
  resource: LicenseQuotaResource,
): boolean => getLicenseQuotaResource(license, resource)?.reached === true;

export const getQuotaUpgradeTargetPlan = (
  license: ILicense | undefined,
  resource: LicenseQuotaResource,
): PaidLicensePlan | null => {
  const tier = license?.quotas?.tier ?? "community";

  return QUOTA_UPGRADE_TARGET_BY_RESOURCE[resource][tier] ?? null;
};

const getLicenseQuotaLimitLabel = (
  quota: LicenseQuotaResourceState | undefined,
  unlimitedLabel: string,
): string =>
  typeof quota?.limit === "number" ? String(quota.limit) : unlimitedLabel;

export const formatLicenseQuotaUsage = (
  quota: LicenseQuotaResourceState | undefined,
  unlimitedLabel: string,
): string => {
  const used = quota?.used ?? 0;
  const limitLabel = getLicenseQuotaLimitLabel(quota, unlimitedLabel);

  return `${used}/${limitLabel}`;
};
