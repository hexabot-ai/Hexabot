/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowType, type Workflow } from "@hexabot-ai/types";

import {
  WORKFLOW_TYPES,
  WORKFLOW_TYPE_ORDER,
} from "@/constants/workflow.constants";

import type {
  FlowMatch,
  FlowTypeGroup,
  FlowTypeInfo,
  FlowTypeKey,
  FlowTypeMeta,
} from "./types";

export const normalizeQuery = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, "");

export const fuzzyMatchIndices = (query: string, text: string): number[] => {
  if (!query) return [];
  const normalizedText = text.toLowerCase();
  let queryIndex = 0;
  const matches: number[] = [];

  for (let textIndex = 0; textIndex < normalizedText.length; textIndex += 1) {
    if (normalizedText[textIndex] === query[queryIndex]) {
      matches.push(textIndex);
      queryIndex += 1;
    }
    if (queryIndex >= query.length) break;
  }

  return queryIndex === query.length ? matches : [];
};

export const buildHighlightSegments = (text: string, matches: number[]) => {
  if (!matches.length) return [{ text, highlight: false }];
  const matchSet = new Set(matches);
  const segments: { text: string; highlight: boolean }[] = [];
  let buffer = "";
  let isHighlighted = matchSet.has(0);

  for (let i = 0; i < text.length; i += 1) {
    const shouldHighlight = matchSet.has(i);

    if (shouldHighlight !== isHighlighted && buffer) {
      segments.push({ text: buffer, highlight: isHighlighted });
      buffer = "";
      isHighlighted = shouldHighlight;
    }
    buffer += text[i];
  }

  if (buffer) {
    segments.push({ text: buffer, highlight: isHighlighted });
  }

  return segments;
};

// @todo: (error count is not part of the typing, maybe expose the info in the useWorkflowDefinitionState hook)
export const getErrorCount = (workflow: Workflow) => {
  const value = (workflow as { errorCount?: number }).errorCount;

  return typeof value === "number" && value > 0 ? value : 0;
};

// @todo: revisit (move to useWorkflowDefinitionState hook ?)
export const isDraftWorkflow = (workflow: Workflow) => {
  return !workflow.publishedVersion;
};

type FlowTypeMetaFormatters = {
  formatCron: (schedule: string) => string;
  noScheduleLabel: string;
  noDetailsLabel: string;
};

/** The secondary text of a workflow in the list, depending on its type. */
export const getFlowTypeMeta = (
  flow: Workflow,
  typeKey: FlowTypeKey,
  { formatCron, noScheduleLabel, noDetailsLabel }: FlowTypeMetaFormatters,
): FlowTypeMeta => {
  if (typeKey === WorkflowType.conversational) {
    return {
      secondaryText: flow.description?.trim() ?? "",
    };
  }

  if (typeKey === WorkflowType.scheduled) {
    const schedule = flow.schedule?.trim();

    return {
      secondaryText: schedule ? formatCron(schedule) : noScheduleLabel,
    };
  }

  if (typeKey === WorkflowType.manual) {
    return {};
  }

  return {
    secondaryText: flow.description?.trim() || noDetailsLabel,
  };
};

/**
 * Group the matches by workflow type. Every known type gets a group, even an
 * empty one; groups follow WORKFLOW_TYPE_ORDER then their label, and the
 * matches of a group are sorted by workflow name.
 */
export const groupFlowMatchesByType = (
  matches: FlowMatch[],
  getTypeLabel: (info: FlowTypeInfo) => string,
): FlowTypeGroup[] => {
  const grouped = new Map<string, FlowTypeGroup>();

  Object.values(WORKFLOW_TYPES).forEach((info) => {
    grouped.set(info.key, { info, label: getTypeLabel(info), items: [] });
  });

  matches.forEach((match) => {
    const key = match.typeInfo.key;

    if (!grouped.has(key)) {
      grouped.set(key, {
        info: match.typeInfo,
        label: getTypeLabel(match.typeInfo),
        items: [],
      });
    }
    grouped.get(key)?.items.push(match);
  });

  const sorted = Array.from(grouped.values()).sort((a, b) => {
    const orderA = WORKFLOW_TYPE_ORDER[a.info.key as WorkflowType] ?? 99;
    const orderB = WORKFLOW_TYPE_ORDER[b.info.key as WorkflowType] ?? 99;

    if (orderA !== orderB) return orderA - orderB;

    return a.label.localeCompare(b.label);
  });

  sorted.forEach((group) => {
    group.items.sort((a, b) => a.workflow.name.localeCompare(b.workflow.name));
  });

  return sorted;
};

/**
 * The type groups to keep open once the groups change: drop the keys of
 * groups that are gone, then open the first group with matches when a search
 * has none open, the group of the selected workflow, or the first group with
 * items when nothing is open. Returns `openKeys` itself when nothing changes.
 */
export const reconcileOpenTypeKeys = (
  openKeys: string[],
  typeGroups: FlowTypeGroup[],
  {
    isSearching,
    selectedFlowTypeKey,
  }: { isSearching: boolean; selectedFlowTypeKey: string | null },
): string[] => {
  if (!typeGroups.length) {
    return openKeys.length ? [] : openKeys;
  }

  const groupsByKey = new Map(
    typeGroups.map((group) => [group.info.key, group]),
  );
  const next = openKeys.filter((key) => groupsByKey.has(key));
  const openSet = new Set(next);
  const firstGroupWithItems = typeGroups.find((group) => group.items.length > 0)
    ?.info.key;
  const fallbackKey = firstGroupWithItems ?? typeGroups[0]?.info.key;

  if (isSearching) {
    const hasOpenWithItems = next.some(
      (key) => (groupsByKey.get(key)?.items.length ?? 0) > 0,
    );

    if (!hasOpenWithItems && fallbackKey) {
      openSet.add(fallbackKey);
    }
  } else if (selectedFlowTypeKey) {
    if (groupsByKey.has(selectedFlowTypeKey)) {
      openSet.add(selectedFlowTypeKey);
    }
  } else if (!openSet.size && fallbackKey) {
    openSet.add(fallbackKey);
  }

  const nextKeys = Array.from(openSet);

  if (
    nextKeys.length === openKeys.length &&
    nextKeys.every((key, index) => key === openKeys[index])
  ) {
    return openKeys;
  }

  return nextKeys;
};
