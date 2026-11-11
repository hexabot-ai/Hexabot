/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { useEffect, useState } from "react";

export type WorkflowGraphColorMode = "light" | "dark" | "system";

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";
// The OS dark-mode preference, when the environment can tell.
const getSystemDarkQuery = (): MediaQueryList | undefined =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(SYSTEM_DARK_QUERY)
    : undefined;
const toColorMode = (query: MediaQueryList | undefined): "light" | "dark" =>
  query?.matches ? "dark" : "light";
const resolveColorMode = (mode: WorkflowGraphColorMode): "light" | "dark" =>
  mode === "system" ? toColorMode(getSystemDarkQuery()) : mode;

/** Resolves "system" against the OS preference and tracks its changes. */
export const useResolvedColorMode = (
  mode: WorkflowGraphColorMode,
): "light" | "dark" => {
  const [resolved, setResolved] = useState(() => resolveColorMode(mode));

  useEffect(() => {
    const media = mode === "system" ? getSystemDarkQuery() : undefined;

    if (!media) {
      setResolved(resolveColorMode(mode));

      return;
    }

    const handleChange = () => {
      setResolved(toColorMode(media));
    };

    handleChange();
    media.addEventListener("change", handleChange);

    return () => {
      media.removeEventListener("change", handleChange);
    };
  }, [mode]);

  return resolved;
};
