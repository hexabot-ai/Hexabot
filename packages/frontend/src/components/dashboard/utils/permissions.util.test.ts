/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from "@hexabot-ai/types";
import { describe, expect, it } from "vitest";

import { EntityType } from "@/services/types";

import {
  filterVisibleDashboardItems,
  formatDashboardSuccessRate,
  getVisibleDashboardKpis,
  getVisibleQuickActions,
  hasDashboardPermissions,
} from "./permissions.util";

const buildPermissionChecker = (
  allowed: Array<readonly [EntityType, Action]>,
) => {
  const allowedKeys = new Set(
    allowed.map(([entity, action]) => `${entity}:${action}`),
  );

  return (entity: EntityType, action: Action) =>
    allowedKeys.has(`${entity}:${action}`);
};

describe("dashboard permission helpers", () => {
  it("requires every permission in a requirement list", () => {
    const hasPermission = buildPermissionChecker([
      [EntityType.STATS, Action.READ],
    ]);

    expect(
      hasDashboardPermissions(
        [
          [EntityType.STATS, Action.READ],
          [EntityType.WORKFLOW, Action.READ],
        ],
        hasPermission,
      ),
    ).toBe(false);
  });

  it("filters items by default requirements and custom visibility", () => {
    const hasPermission = buildPermissionChecker([
      [EntityType.WORKFLOW, Action.READ],
    ]);
    const visibleItems = filterVisibleDashboardItems(
      [
        {
          id: "workflow",
          requires: [[EntityType.WORKFLOW, Action.READ]],
        },
        {
          id: "runs",
          requires: [[EntityType.WORKFLOW_RUN, Action.READ]],
        },
        {
          id: "custom",
          isVisible: () => true,
        },
      ],
      hasPermission,
    );

    expect(visibleItems.map(({ id }) => id)).toEqual(["workflow", "custom"]);
  });

  it("returns only KPI cards whose metric permissions are readable", () => {
    const hasPermission = buildPermissionChecker([
      [EntityType.STATS, Action.READ],
      [EntityType.WORKFLOW, Action.READ],
      [EntityType.WORKFLOW_RUN, Action.READ],
    ]);

    expect(getVisibleDashboardKpis(hasPermission)).toEqual([
      "totalWorkflows",
      "totalRuns",
      "successRate",
    ]);
  });

  it("filters quick actions by their action-specific permissions", () => {
    const hasPermission = buildPermissionChecker([
      [EntityType.WORKFLOW, Action.READ],
      [EntityType.WORKFLOW, Action.CREATE],
      [EntityType.WORKFLOW_RUN, Action.READ],
    ]);

    expect(getVisibleQuickActions(hasPermission).map(({ id }) => id)).toEqual([
      "create",
      "run",
      "approvals",
      "failed",
    ]);
  });

  it("formats success rate ratios as percentages", () => {
    expect(formatDashboardSuccessRate(0.6, "—")).toBe("60.0%");
    expect(formatDashboardSuccessRate(undefined, "—")).toBe("—");
  });
});
