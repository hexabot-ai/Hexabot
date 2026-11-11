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
