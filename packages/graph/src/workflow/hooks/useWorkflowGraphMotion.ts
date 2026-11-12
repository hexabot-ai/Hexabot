/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { OnMove, Viewport } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { isSameViewport } from "../utils/workflow-graph.utils";

type UseWorkflowGraphMotionProps = {
  initialViewport: Viewport;
  onViewportChange: (viewport: Viewport) => void;
};

/**
 * Tracks whether the canvas is being panned or zoomed and its current zoom,
 * and reports the viewport a move ends on unless it is where the last move
 * ended (or, before any move, the initial viewport).
 */
export const useWorkflowGraphMotion = ({
  initialViewport,
  onViewportChange,
}: UseWorkflowGraphMotionProps) => {
  const [isMoving, setIsMoving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const lastViewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });

  useEffect(() => {
    lastViewportRef.current = initialViewport;
    setZoom(initialViewport.zoom);
  }, [initialViewport.x, initialViewport.y, initialViewport.zoom]);

  const onMoveStart = useCallback<OnMove>((_event, nextViewport) => {
    setIsMoving(true);
    setZoom(nextViewport.zoom);
  }, []);
  // Ignore zoom jitter below 1% while moving.
  const onMove = useCallback<OnMove>((_event, nextViewport) => {
    setZoom((current) =>
      Math.abs(current - nextViewport.zoom) <= 0.01
        ? current
        : nextViewport.zoom,
    );
  }, []);
  const onMoveEnd = useCallback<OnMove>(
    (_event, nextViewport) => {
      setIsMoving(false);
      setZoom(nextViewport.zoom);

      if (isSameViewport(lastViewportRef.current, nextViewport)) {
        return;
      }

      lastViewportRef.current = nextViewport;
      onViewportChange(nextViewport);
    },
    [onViewportChange],
  );

  return { isMoving, zoom, onMoveStart, onMove, onMoveEnd };
};
