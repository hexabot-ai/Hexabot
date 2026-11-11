/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { useAuth } from "@/hooks/useAuth";
import { useTranslate } from "@/hooks/useTranslate";
import type { LicenseQuotaResource } from "@/types/user.types";

import {
  formatLicenseQuotaUsage,
  getLicenseQuotaResource,
  getQuotaUpgradeTargetPlan,
  isLicenseQuotaReached,
} from "./license-quotas";

/**
 * The license quota of a resource for the signed-in user: whether it is
 * reached, the plan to upgrade to once it is, and its "used/limit" usage.
 */
export const useLicenseQuota = (resource: LicenseQuotaResource) => {
  const { user } = useAuth();
  const { t } = useTranslate();
  const isReached = isLicenseQuotaReached(user?.license, resource);

  return {
    isReached,
    upgradeTargetPlan: isReached
      ? getQuotaUpgradeTargetPlan(user?.license, resource)
      : null,
    usage: formatLicenseQuotaUsage(
      getLicenseQuotaResource(user?.license, resource),
      t("label.unlimited"),
    ),
  };
};
