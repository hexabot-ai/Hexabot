/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ILicense } from "@/types/user.types";

import { useLicenseQuota } from "./useLicenseQuota";

const auth = vi.hoisted(() => ({ license: undefined as unknown }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { license: auth.license } }),
}));
vi.mock("@/hooks/useTranslate", () => ({
  useTranslate: () => ({ t: (key: string) => key }),
}));

const getQuota = (license?: Partial<ILicense>) => {
  auth.license = license;
  const onRender = vi.fn<(quota: ReturnType<typeof useLicenseQuota>) => void>();
  const Probe = ({
    onQuota,
  }: {
    onQuota: (quota: ReturnType<typeof useLicenseQuota>) => void;
  }) => {
    onQuota(useLicenseQuota("workflows"));

    return null;
  };

  renderToStaticMarkup(<Probe onQuota={onRender} />);

  return onRender.mock.calls[0]?.[0];
};
const licenseWithWorkflows = (
  tier: ILicense["quotas"]["tier"],
  workflows: { used: number; limit: number | null; reached: boolean },
) =>
  ({
    quotas: {
      tier,
      resources: { workflows, users: { used: 0, limit: null, reached: false } },
    },
  }) as unknown as Partial<ILicense>;

describe("useLicenseQuota", () => {
  it("reports an unlimited quota without a license", () => {
    expect(getQuota()).toEqual({
      isReached: false,
      upgradeTargetPlan: null,
      usage: "0/label.unlimited",
    });
  });

  it("offers the next plan once the quota is reached", () => {
    expect(
      getQuota(
        licenseWithWorkflows("community", {
          used: 10,
          limit: 10,
          reached: true,
        }),
      ),
    ).toEqual({
      isReached: true,
      upgradeTargetPlan: "starter",
      usage: "10/10",
    });
  });

  it("offers no plan while the quota is not reached", () => {
    expect(
      getQuota(
        licenseWithWorkflows("starter", { used: 3, limit: 25, reached: false }),
      ),
    ).toEqual({ isReached: false, upgradeTargetPlan: null, usage: "3/25" });
  });
});
