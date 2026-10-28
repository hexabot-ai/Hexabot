/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WaitInfo } from "@hexabot-ai/agentic";
import {
  Action,
  type WorkflowRun,
  type WorkflowRunFull,
} from "@hexabot-ai/types";
import { Button, Stack } from "@mui/material";
import { CheckCircle, PencilLine, XCircle } from "lucide-react";

import { useHasPermission } from "@/hooks/useHasPermission";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";

import { useOperatorDialogs } from "../../hooks/useOperatorDialogs";
import { isApprovalWait } from "../../operator.utils";

type OperatorWaitActionsProps = {
  run: WorkflowRun | WorkflowRunFull;
  wait: WaitInfo;
  size?: "small" | "medium";
};

/**
 * Buttons resolving one operator wait: Reject / Approve for an approval,
 * Resume for a resume wait. Hidden without the `workflowrun:update`
 * permission.
 */
export const OperatorWaitActions = ({
  run,
  wait,
  size = "small",
}: OperatorWaitActionsProps) => {
  const { t } = useTranslate();
  const hasPermission = useHasPermission();
  const { openForWait } = useOperatorDialogs();

  if (!hasPermission(EntityType.WORKFLOW_RUN, Action.UPDATE)) {
    return null;
  }

  if (!isApprovalWait(wait)) {
    return (
      <Button
        size={size}
        variant="contained"
        startIcon={<PencilLine size={16} />}
        onClick={() => void openForWait(run, wait)}
      >
        {t("button.provide_input")}
      </Button>
    );
  }

  return (
    <Stack direction="row" spacing={1}>
      <Button
        size={size}
        variant="outlined"
        color="error"
        startIcon={<XCircle size={16} />}
        onClick={() => void openForWait(run, wait, "reject")}
      >
        {t("button.reject")}
      </Button>
      <Button
        size={size}
        variant="contained"
        color="success"
        startIcon={<CheckCircle size={16} />}
        onClick={() => void openForWait(run, wait, "approve")}
      >
        {t("button.approve")}
      </Button>
    </Stack>
  );
};
