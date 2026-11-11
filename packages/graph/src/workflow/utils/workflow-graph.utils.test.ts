/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import {
  WORKFLOW_VIEWPORT_MAX_ZOOM,
  WORKFLOW_VIEWPORT_MIN_ZOOM,
} from "../constants/workflow.constants";

import {
  isMeaningfulWorkflowViewport,
  normalizeWorkflowViewportZoom,
} from "./workflow-graph.utils";

describe("workflow viewport utilities", () => {
  it("clamps persisted zoom to xyflow's supported positive range", () => {
    expect(normalizeWorkflowViewportZoom(0)).toBe(1);
    expect(normalizeWorkflowViewportZoom(-1)).toBe(1);
    expect(normalizeWorkflowViewportZoom(WORKFLOW_VIEWPORT_MIN_ZOOM / 2)).toBe(
      WORKFLOW_VIEWPORT_MIN_ZOOM,
    );
    expect(normalizeWorkflowViewportZoom(WORKFLOW_VIEWPORT_MAX_ZOOM + 1)).toBe(
      WORKFLOW_VIEWPORT_MAX_ZOOM,
    );
  });

  it("treats the default viewport as not meaningfully persisted", () => {
    expect(isMeaningfulWorkflowViewport({ x: 0, y: 0, zoom: 1 })).toBe(false);
    expect(isMeaningfulWorkflowViewport({ x: 120, y: -80, zoom: 1 })).toBe(
      true,
    );
  });
});
