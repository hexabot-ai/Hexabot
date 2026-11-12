/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

// @vitest-environment jsdom

import type { Viewport } from "@xyflow/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderHook } from "../../test/render-hook";

import { useWorkflowGraphMotion } from "./useWorkflowGraphMotion";

const setup = (initialViewport: Viewport) => {
  const onViewportChange = vi.fn();
  const hook = renderHook(useWorkflowGraphMotion, {
    initialViewport,
    onViewportChange,
  });
  const move = (
    handler: "onMoveStart" | "onMove" | "onMoveEnd",
    viewport: Viewport,
  ) => {
    act(() => {
      hook.result.current[handler](null, viewport);
    });
  };

  return { ...hook, onViewportChange, move };
};

describe("useWorkflowGraphMotion", () => {
  it("starts at the initial zoom, not moving", () => {
    const { result } = setup({ x: 0, y: 0, zoom: 0.5 });

    expect(result.current.isMoving).toBe(false);
    expect(result.current.zoom).toBe(0.5);
  });

  it("tracks a move and ignores zoom jitter under 1%", () => {
    const { result, move } = setup({ x: 0, y: 0, zoom: 1 });

    move("onMoveStart", { x: 0, y: 0, zoom: 1 });

    expect(result.current.isMoving).toBe(true);

    move("onMove", { x: 5, y: 0, zoom: 1.005 });

    expect(result.current.zoom).toBe(1);

    move("onMove", { x: 5, y: 0, zoom: 1.5 });

    expect(result.current.zoom).toBe(1.5);

    move("onMoveEnd", { x: 5, y: 0, zoom: 1.504 });

    expect(result.current.isMoving).toBe(false);
    expect(result.current.zoom).toBe(1.504);
  });

  it("reports where a move ends, unless the viewport did not change", () => {
    const { move, onViewportChange } = setup({ x: 10, y: 20, zoom: 1 });

    move("onMoveEnd", { x: 10.005, y: 20, zoom: 1 });

    expect(onViewportChange).not.toHaveBeenCalled();

    move("onMoveEnd", { x: 40, y: 20, zoom: 1 });
    move("onMoveEnd", { x: 40, y: 20, zoom: 1 });

    expect(onViewportChange).toHaveBeenCalledTimes(1);
    expect(onViewportChange).toHaveBeenCalledWith({ x: 40, y: 20, zoom: 1 });
  });

  it("restarts from a new initial viewport", () => {
    const { result, rerender, move, onViewportChange } = setup({
      x: 0,
      y: 0,
      zoom: 1,
    });

    rerender({
      initialViewport: { x: 40, y: 20, zoom: 2 },
      onViewportChange,
    });

    expect(result.current.zoom).toBe(2);

    move("onMoveEnd", { x: 40, y: 20, zoom: 2 });

    expect(onViewportChange).not.toHaveBeenCalled();
  });
});
