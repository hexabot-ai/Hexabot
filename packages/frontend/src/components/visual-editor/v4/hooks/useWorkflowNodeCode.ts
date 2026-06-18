/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { useCallback, useState } from "react";

/**
 * Manages the "See Code" feature: tracks which node's def is currently
 * highlighted in the YAML editor.
 *
 * State semantics:
 *   string    → that def is active (YAML highlighted)
 *   undefined → no active highlight
 */
export function useWorkflowNodeCode() {
  const [activeCodeDef, setActiveCodeDef] = useState<string | undefined>(
    undefined,
  );
  /** Called by the graph "See Code" button — toggles highlight on/off. */
  const onViewNodeCode = useCallback((defName: string) => {
    setActiveCodeDef((prev) => (prev === defName ? undefined : defName));
  }, []);
  /** Called by FlowsDrawer when the highlight is cleared internally (e.g. Monaco click outside highlighted range). */
  const onActiveDefChange = useCallback((defName: string | null) => {
    setActiveCodeDef(defName ?? undefined);
  }, []);
  /** Called when a node is removed — clears the highlight. */
  const clearActiveCodeDef = useCallback(() => {
    setActiveCodeDef(undefined);
  }, []);

  return {
    /** Pass as `activeCodeDef` prop to FlowsDrawer. */
    activeCodeDef,
    /** Pass as `activeCodeDefName` in WorkflowGraphCallbacks. */
    activeCodeDefName: activeCodeDef,
    onViewNodeCode,
    onActiveDefChange,
    clearActiveCodeDef,
  };
}
