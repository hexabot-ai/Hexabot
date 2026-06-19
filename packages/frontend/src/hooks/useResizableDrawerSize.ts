/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";

import { useLocalStorage } from "@/hooks/useLocalStorage";

export interface UseResizableDrawerSizeOptions {
  /** Unique localStorage key — persists the width or height across sessions. */
  sizeStorageKey: string;
  /** Fallback size (px) when nothing is persisted yet. */
  defaultSize: number;
  /** Lower bound in pixels. */
  minSize: number;
  /**
   * Upper bound in pixels. Pass a getter when the limit depends on a live DOM
   * measurement (called on every mousemove). Return `undefined` to skip the
   * upper clamp (e.g. before the container is mounted and `clientWidth` is 0).
   */
  maxSize?: number | (() => number | undefined);
  /**
   * - `"horizontal"` — tracks `clientX`, dragging right increases width.
   * - `"vertical"`   — tracks `clientY`, dragging up increases height.
   */
  axis: "horizontal" | "vertical";
  /**
   * Called on mousedown with the current size. Use it to seed the size from a
   * DOM measurement when the element starts in a fluid state (size === 0).
   */
  onResizeStart?: (initialSize: number) => void;
}

export interface UseResizableDrawerSizeReturn {
  /** Current width or height in pixels. */
  size: number;
  /** Setter — use to re-clamp or reset the size externally. */
  setSize: Dispatch<SetStateAction<number>>;
  /** Attach to the resize handle's `onMouseDown`. */
  handleResizeStart: (event: ReactMouseEvent<HTMLElement>) => void;
}

export const useResizableDrawerSize = ({
  sizeStorageKey,
  defaultSize,
  minSize,
  maxSize,
  axis,
  onResizeStart,
}: UseResizableDrawerSizeOptions): UseResizableDrawerSizeReturn => {
  const { getLocalStorage, setLocalStorage } = useLocalStorage();
  // Normalize maxSize to a stable getter so clampSize never needs
  // to re-register listeners when maxSize changes between renders.
  const maxSizeRef = useRef<() => number | undefined>(
    typeof maxSize === "function" ? maxSize : () => maxSize,
  );

  useEffect(() => {
    maxSizeRef.current =
      typeof maxSize === "function" ? maxSize : () => maxSize;
  }, [maxSize]);

  const clampSize = useCallback(
    (value: number) => {
      const max = maxSizeRef.current();

      return Math.min(
        max !== undefined ? max : Infinity,
        Math.max(value, minSize),
      );
    },
    [minSize],
  );
  const [size, setSize] = useState(() =>
    clampSize(Number(getLocalStorage(sizeStorageKey, defaultSize))),
  );
  // Drag state bundled in one ref — avoids multiple individual refs.
  const dragRef = useRef({
    startCoord: 0,
    startSize: 0,
    currentSize: 0,
    active: false,
  });

  // Re-clamp when bounds change (e.g. breakpoint switch).
  useEffect(() => {
    setSize((prev) => clampSize(prev));
  }, [clampSize]);

  // Global listeners so dragging continues outside the handle element.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const isHorizontal = axis === "horizontal";
    const handleMouseMove = (event: MouseEvent) => {
      if (!dragRef.current.active) return;

      const coord = isHorizontal ? event.clientX : event.clientY;
      // Vertical is inverted: dragging up (decreasing clientY) grows the size.
      const delta = isHorizontal
        ? coord - dragRef.current.startCoord
        : dragRef.current.startCoord - coord;
      const next = clampSize(dragRef.current.startSize + delta);

      dragRef.current.currentSize = next;
      setSize(next);
    };
    const handleMouseUp = () => {
      if (!dragRef.current.active) return;

      dragRef.current.active = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setLocalStorage(sizeStorageKey, String(dragRef.current.currentSize));
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [axis, clampSize, sizeStorageKey]);

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const isHorizontal = axis === "horizontal";

      dragRef.current = {
        active: true,
        startCoord: isHorizontal ? event.clientX : event.clientY,
        startSize: size,
        currentSize: size,
      };
      document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      event.preventDefault();
      onResizeStart?.(size);
    },
    [axis, onResizeStart, size],
  );

  return { size, setSize, handleResizeStart };
};
