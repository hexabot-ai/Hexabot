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
  resolveFocusedStepIdAfterChange,
  resolveWorkflowDefaultViewport,
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

  it("opens a meaningful persisted viewport as is, parsing string coordinates", () => {
    expect(
      resolveWorkflowDefaultViewport({ x: "120", y: -80, zoom: "1.5" }),
    ).toEqual({
      defaultViewport: { x: 120, y: -80, zoom: 1.5 },
      hasPersistedViewport: true,
    });
  });

  it("fills the gaps of a missing or unusable viewport with defaults", () => {
    const notPersisted = (defaultViewport: object) => ({
      defaultViewport,
      hasPersistedViewport: false,
    });

    expect(resolveWorkflowDefaultViewport({})).toEqual(
      notPersisted({ x: 0, y: 0, zoom: 1 }),
    );
    expect(resolveWorkflowDefaultViewport({ x: 0, y: 0, zoom: 1 })).toEqual(
      notPersisted({ x: 0, y: 0, zoom: 1 }),
    );
    expect(
      resolveWorkflowDefaultViewport({ x: "", y: null, zoom: "abc" }),
    ).toEqual(notPersisted({ x: 0, y: 0, zoom: 1 }));
    // A blank coordinate is missing, not 0: the viewport is not persisted.
    expect(resolveWorkflowDefaultViewport({ x: "", y: 120, zoom: 1 })).toEqual(
      notPersisted({ x: 0, y: 120, zoom: 1 }),
    );
    expect(
      resolveWorkflowDefaultViewport({ x: 40, y: "-5", zoom: 10 }),
    ).toEqual(notPersisted({ x: 40, y: -5, zoom: WORKFLOW_VIEWPORT_MAX_ZOOM }));
    expect(resolveWorkflowDefaultViewport({ x: 40, y: 50, zoom: 0 })).toEqual(
      notPersisted({ x: 40, y: 50, zoom: 1 }),
    );
  });

  it("focuses the added step after an insertion", () => {
    expect(resolveFocusedStepIdAfterChange(["a", "b"], ["a", "c", "b"])).toBe(
      "c",
    );
    expect(resolveFocusedStepIdAfterChange([], ["a"])).toBe("a");
  });

  it("focuses the step before the last removed one after a deletion", () => {
    // Index-based ids: removing the 2nd of three steps drops the last id.
    expect(
      resolveFocusedStepIdAfterChange(["s0", "s1", "s2"], ["s0", "s1"]),
    ).toBe("s1");
    expect(resolveFocusedStepIdAfterChange(["s0", "s1"], ["s0"])).toBe("s0");
    // Same count but a different id: still a removal.
    expect(resolveFocusedStepIdAfterChange(["a", "b"], ["a", "c"])).toBe("a");
  });

  it("falls back to the first step when no earlier step remains", () => {
    expect(resolveFocusedStepIdAfterChange(["a", "b"], ["c"])).toBe("c");
    expect(resolveFocusedStepIdAfterChange(["a"], [])).toBeUndefined();
  });

  it("focuses nothing when the steps did not change", () => {
    expect(
      resolveFocusedStepIdAfterChange(["a", "b"], ["a", "b"]),
    ).toBeUndefined();
  });
});
