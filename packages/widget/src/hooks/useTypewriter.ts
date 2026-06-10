/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { useEffect, useMemo, useState } from "react";

interface UseTypewriterOptions {
  enabled?: boolean;
  maxDuration?: number;
  minDuration?: number;
  msPerCharacter?: number;
}

interface UseTypewriterResult {
  isTypewriting: boolean;
  visibleText: string;
}

const TYPEWRITER_MIN_DURATION_MS = 500;
const TYPEWRITER_MAX_DURATION_MS = 2200;
const TYPEWRITER_MS_PER_CHARACTER = 24;
const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const useTypewriter = (
  text: string,
  {
    enabled = false,
    maxDuration = TYPEWRITER_MAX_DURATION_MS,
    minDuration = TYPEWRITER_MIN_DURATION_MS,
    msPerCharacter = TYPEWRITER_MS_PER_CHARACTER,
  }: UseTypewriterOptions = {},
): UseTypewriterResult => {
  const characters = useMemo(() => Array.from(text), [text]);
  const shouldTypewrite = enabled && !prefersReducedMotion();
  const [visibleLength, setVisibleLength] = useState(() =>
    shouldTypewrite ? 0 : characters.length,
  );
  const visibleText = useMemo(
    () =>
      shouldTypewrite ? characters.slice(0, visibleLength).join("") : text,
    [characters, shouldTypewrite, text, visibleLength],
  );
  const isTypewriting = shouldTypewrite && visibleLength < characters.length;

  useEffect(() => {
    if (!shouldTypewrite || characters.length === 0) {
      setVisibleLength(characters.length);

      return undefined;
    }

    let frameId: number | undefined;
    let startTime: number | undefined;
    let lastVisibleLength = 0;
    const duration = Math.min(
      maxDuration,
      Math.max(minDuration, characters.length * msPerCharacter),
    );
    const updateFrame = (timestamp: number) => {
      if (startTime === undefined) {
        startTime = timestamp;
      }

      const progress = Math.min((timestamp - startTime) / duration, 1);
      const nextVisibleLength = Math.min(
        characters.length,
        Math.floor(progress * characters.length),
      );

      if (nextVisibleLength !== lastVisibleLength) {
        lastVisibleLength = nextVisibleLength;
        setVisibleLength(nextVisibleLength);
      }

      if (progress < 1) {
        frameId = window.requestAnimationFrame(updateFrame);
      }
    };

    setVisibleLength(0);
    frameId = window.requestAnimationFrame(updateFrame);

    return () => {
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [
    characters.length,
    maxDuration,
    minDuration,
    msPerCharacter,
    shouldTypewrite,
    text,
  ]);

  return {
    isTypewriting,
    visibleText,
  };
};
