/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Loader2 } from "lucide-react";

export const WorkflowLoadingState = () => (
  <div className="workflow-loading-overlay" aria-label="Loading workflow">
    <Loader2 className="workflow-icon-spin workflow-loading-icon" />
  </div>
);
