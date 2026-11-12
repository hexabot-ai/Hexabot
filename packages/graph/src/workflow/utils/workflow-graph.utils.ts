/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Viewport } from "@xyflow/react";

import {
  DEFAULT_WORKFLOW_VIEWPORT,
  VIEWPORT_EPSILON,
  WORKFLOW_VIEWPORT_MAX_ZOOM,
  WORKFLOW_VIEWPORT_MIN_ZOOM,
} from "../constants/workflow.constants";

export const isSameViewport = (a: Viewport, b: Viewport): boolean =>
  Math.abs(a.x - b.x) <= VIEWPORT_EPSILON &&
  Math.abs(a.y - b.y) <= VIEWPORT_EPSILON &&
  Math.abs(a.zoom - b.zoom) <= VIEWPORT_EPSILON;

export const normalizeWorkflowViewportZoom = (
  zoom: number,
  fallback = DEFAULT_WORKFLOW_VIEWPORT.zoom,
): number => {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return fallback;
  }

  return Math.min(
    WORKFLOW_VIEWPORT_MAX_ZOOM,
    Math.max(WORKFLOW_VIEWPORT_MIN_ZOOM, zoom),
  );
};

export const isMeaningfulWorkflowViewport = (viewport: Viewport): boolean => {
  return (
    Number.isFinite(viewport.x) &&
    Number.isFinite(viewport.y) &&
    Number.isFinite(viewport.zoom) &&
    viewport.zoom >= WORKFLOW_VIEWPORT_MIN_ZOOM &&
    viewport.zoom <= WORKFLOW_VIEWPORT_MAX_ZOOM &&
    !isSameViewport(viewport, DEFAULT_WORKFLOW_VIEWPORT)
  );
};

/** A viewport as the host persists it: any coordinate may be missing or a string. */
export type ViewportState = {
  id?: string | null;
  x?: number | string | null;
  y?: number | string | null;
  zoom?: number | string | null;
};

const parseViewportNumber = (
  value: number | string | null | undefined,
): number =>
  value === null || value === undefined || value === ""
    ? Number.NaN
    : Number(value);

/**
 * The viewport to open a workflow with: the persisted one when it is
 * meaningful (finite, zoom within bounds, not the {0,0,1} default),
 * otherwise its finite coordinates with defaults filling the gaps.
 */
export const resolveWorkflowDefaultViewport = (
  viewport: Omit<ViewportState, "id">,
): { defaultViewport: Viewport; hasPersistedViewport: boolean } => {
  const parsedViewport = {
    x: parseViewportNumber(viewport.x),
    y: parseViewportNumber(viewport.y),
    zoom: parseViewportNumber(viewport.zoom),
  };

  if (isMeaningfulWorkflowViewport(parsedViewport)) {
    return { defaultViewport: parsedViewport, hasPersistedViewport: true };
  }

  return {
    defaultViewport: {
      x: Number.isFinite(parsedViewport.x)
        ? parsedViewport.x
        : DEFAULT_WORKFLOW_VIEWPORT.x,
      y: Number.isFinite(parsedViewport.y)
        ? parsedViewport.y
        : DEFAULT_WORKFLOW_VIEWPORT.y,
      zoom: normalizeWorkflowViewportZoom(parsedViewport.zoom),
    },
    hasPersistedViewport: false,
  };
};

/**
 * The step to bring into view after the workflow's steps changed: the added
 * step on an insertion, otherwise the nearest step still present before the
 * last removed one (or the first step). The step count tells an insertion
 * from a deletion — step ids are index-based, so a deletion shifts the
 * following ids and makes them look new.
 */
export const resolveFocusedStepIdAfterChange = (
  prevStepIds: readonly string[],
  stepIds: readonly string[],
): string | undefined => {
  if (stepIds.length > prevStepIds.length) {
    const prevStepIdSet = new Set(prevStepIds);
    const addedStepId = stepIds.find((id) => !prevStepIdSet.has(id));

    if (addedStepId !== undefined) {
      return addedStepId;
    }
  }

  const stepIdSet = new Set(stepIds);
  const lastRemovedIndex = prevStepIds.reduce(
    (last, id, index) => (stepIdSet.has(id) ? last : index),
    -1,
  );

  if (lastRemovedIndex === -1) {
    return undefined;
  }

  return (
    prevStepIds
      .slice(0, lastRemovedIndex)
      .reverse()
      .find((id) => stepIdSet.has(id)) ?? stepIds[0]
  );
};
