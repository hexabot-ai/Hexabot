/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WaitInfo } from "@hexabot-ai/agentic";
import type { WorkflowRun, WorkflowRunFull } from "@hexabot-ai/types";
import { useCallback } from "react";

import { useDialogs } from "@/hooks/useDialogs";

import {
  ApprovalDialog,
  type ApprovalDecision,
} from "../components/operator/ApprovalDialog";
import { CancelRunDialog } from "../components/operator/CancelRunDialog";
import { ResumeDialog } from "../components/operator/ResumeDialog";
import { isResumeWait } from "../operator.utils";

type OperatorRun = WorkflowRun | WorkflowRunFull;

/**
 * Open the dialogs an admin resolves suspended runs with. Each resolves with
 * the run the API returned, or `undefined` when nothing was applied.
 */
export const useOperatorDialogs = () => {
  const dialogs = useDialogs();
  const openForWait = useCallback(
    (run: OperatorRun, wait: WaitInfo, decision?: ApprovalDecision) =>
      isResumeWait(wait)
        ? dialogs.open(ResumeDialog, { run, wait })
        : dialogs.open(ApprovalDialog, { run, wait, decision }),
    [dialogs],
  );
  const openCancel = useCallback(
    (run: OperatorRun) => dialogs.open(CancelRunDialog, { run }),
    [dialogs],
  );

  return { openForWait, openCancel };
};
