/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import type {
  ILicense,
  LicenseQuotaResource,
  LicenseQuotaTier,
  PaidLicensePlan,
} from "@/types/user.types";

import { getQuotaUpgradeTargetPlan } from "./license-quotas";

const buildLicense = (tier: LicenseQuotaTier): ILicense => ({
  activationLimit: null,
  activationUsage: null,
  plan: tier === "community" ? "unknown" : tier,
  status: tier === "community" ? "inactive" : "active",
  lastError: null,
  quotas: {
    tier,
    resources: {
      users: {
        limit: 1,
        used: 1,
        remaining: 0,
        reached: true,
      },
      workflows: {
        limit: 3,
        used: 3,
        remaining: 0,
        reached: true,
      },
    },
  },
});

describe("getQuotaUpgradeTargetPlan", () => {
  const assertTarget = (
    tier: LicenseQuotaTier,
    resource: LicenseQuotaResource,
    expected: PaidLicensePlan | null,
  ) => {
    expect(getQuotaUpgradeTargetPlan(buildLicense(tier), resource)).toBe(
      expected,
    );
  };

  it("maps users quotas to the expected upgrade targets", () => {
    assertTarget("community", "users", "pro");
    assertTarget("starter", "users", "pro");
    assertTarget("pro", "users", "unlimited");
    assertTarget("unlimited", "users", null);
  });

  it("maps workflows quotas to the expected upgrade targets", () => {
    assertTarget("community", "workflows", "starter");
    assertTarget("starter", "workflows", "pro");
    assertTarget("pro", "workflows", "unlimited");
    assertTarget("unlimited", "workflows", null);
  });

  it("falls back to community mapping when license is missing", () => {
    expect(getQuotaUpgradeTargetPlan(undefined, "users")).toBe("pro");
    expect(getQuotaUpgradeTargetPlan(undefined, "workflows")).toBe("starter");
  });
});
