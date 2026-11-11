/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowType, type Workflow } from "@hexabot-ai/types";
import { describe, expect, it } from "vitest";

import { WORKFLOW_TYPES } from "@/constants/workflow.constants";

import type { FlowMatch, FlowTypeGroup, FlowTypeInfo } from "./types";
import {
  getFlowTypeMeta,
  groupFlowMatchesByType,
  reconcileOpenTypeKeys,
} from "./utils";

const createWorkflow = (overrides: Partial<Workflow> = {}) =>
  ({
    id: "wf-1",
    name: "Welcome",
    type: WorkflowType.conversational,
    ...overrides,
  }) as Workflow;
const createMatch = (workflow: Workflow, typeInfo?: FlowTypeInfo) =>
  ({
    workflow,
    typeInfo: typeInfo ?? WORKFLOW_TYPES[workflow.type],
  }) as FlowMatch;
const formatters = {
  formatCron: (schedule: string) => `every ${schedule}`,
  noScheduleLabel: "No schedule",
  noDetailsLabel: "No details",
};
const typeLabel = (info: FlowTypeInfo) => String(info.key).toUpperCase();
const groupsWithItems = (counts: Record<string, number>): FlowTypeGroup[] =>
  Object.entries(counts).map(([key, count]) => ({
    info: { key } as FlowTypeInfo,
    label: key,
    items: Array(count).fill(createMatch(createWorkflow())),
  }));

describe("getFlowTypeMeta", () => {
  it("shows the description of a conversational workflow", () => {
    expect(
      getFlowTypeMeta(
        createWorkflow({ description: " Greets users " }),
        WorkflowType.conversational,
        formatters,
      ),
    ).toEqual({ secondaryText: "Greets users" });
    expect(
      getFlowTypeMeta(
        createWorkflow(),
        WorkflowType.conversational,
        formatters,
      ),
    ).toEqual({ secondaryText: "" });
  });

  it("shows the formatted schedule of a scheduled workflow", () => {
    expect(
      getFlowTypeMeta(
        createWorkflow({ schedule: " 0 9 * * * " }),
        WorkflowType.scheduled,
        formatters,
      ),
    ).toEqual({ secondaryText: "every 0 9 * * *" });
    expect(
      getFlowTypeMeta(
        createWorkflow({ schedule: " " }),
        WorkflowType.scheduled,
        formatters,
      ),
    ).toEqual({ secondaryText: "No schedule" });
  });

  it("shows nothing for a manual workflow", () => {
    expect(
      getFlowTypeMeta(
        createWorkflow({ description: "Run me" }),
        WorkflowType.manual,
        formatters,
      ),
    ).toEqual({});
  });

  it("falls back to the description or a placeholder for other types", () => {
    expect(
      getFlowTypeMeta(
        createWorkflow({ description: " " }),
        "custom",
        formatters,
      ),
    ).toEqual({ secondaryText: "No details" });
  });
});

describe("groupFlowMatchesByType", () => {
  it("lists every known type in order, even without matches", () => {
    const groups = groupFlowMatchesByType([], typeLabel);

    expect(groups.map((group) => group.info.key)).toEqual([
      WorkflowType.conversational,
      WorkflowType.scheduled,
      WorkflowType.manual,
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "CONVERSATIONAL",
      "SCHEDULED",
      "MANUAL",
    ]);
    expect(groups.every((group) => group.items.length === 0)).toBe(true);
  });

  it("sorts the matches of a group by name", () => {
    const groups = groupFlowMatchesByType(
      [
        createMatch(createWorkflow({ name: "Zeta" })),
        createMatch(
          createWorkflow({ name: "Nightly", type: WorkflowType.scheduled }),
        ),
        createMatch(createWorkflow({ name: "alpha" })),
      ],
      typeLabel,
    );

    expect(groups[0].items.map((match) => match.workflow.name)).toEqual([
      "alpha",
      "Zeta",
    ]);
    expect(groups[1].items.map((match) => match.workflow.name)).toEqual([
      "Nightly",
    ]);
  });

  it("puts unknown types last, sorted by label", () => {
    const groups = groupFlowMatchesByType(
      [
        createMatch(createWorkflow(), { key: "zz" } as FlowTypeInfo),
        createMatch(createWorkflow(), { key: "aa" } as FlowTypeInfo),
      ],
      typeLabel,
    );

    expect(groups.map((group) => group.info.key).slice(3)).toEqual([
      "aa",
      "zz",
    ]);
  });
});

describe("reconcileOpenTypeKeys", () => {
  const groups = groupsWithItems({
    conversational: 0,
    scheduled: 2,
    manual: 1,
  });
  const reconcile = (
    openKeys: string[],
    options: {
      isSearching?: boolean;
      selectedFlowTypeKey?: string | null;
    } = {},
    typeGroups = groups,
  ) =>
    reconcileOpenTypeKeys(openKeys, typeGroups, {
      isSearching: options.isSearching ?? false,
      selectedFlowTypeKey: options.selectedFlowTypeKey ?? null,
    });

  it("closes everything when there are no groups", () => {
    const empty: string[] = [];

    expect(reconcile(["scheduled"], {}, [])).toEqual([]);
    expect(reconcile(empty, {}, [])).toBe(empty);
  });

  it("drops the keys of groups that are gone", () => {
    expect(reconcile(["system", "manual"])).toEqual(["manual"]);
  });

  it("opens the first group with items when nothing is open", () => {
    expect(reconcile([])).toEqual(["scheduled"]);
    expect(
      reconcile([], {}, groupsWithItems({ conversational: 0, manual: 0 })),
    ).toEqual(["conversational"]);
  });

  it("opens the group of the selected workflow", () => {
    expect(
      reconcile(["manual"], { selectedFlowTypeKey: "conversational" }),
    ).toEqual(["manual", "conversational"]);
    expect(reconcile([], { selectedFlowTypeKey: "system" })).toEqual([]);
  });

  it("opens a group with matches when a search has none open", () => {
    expect(reconcile(["conversational"], { isSearching: true })).toEqual([
      "conversational",
      "scheduled",
    ]);
    expect(
      reconcile(["manual"], {
        isSearching: true,
        selectedFlowTypeKey: "scheduled",
      }),
    ).toEqual(["manual"]);
  });

  it("returns the same array when nothing changes", () => {
    const openKeys = ["scheduled"];

    expect(reconcile(openKeys)).toBe(openKeys);
  });
});
