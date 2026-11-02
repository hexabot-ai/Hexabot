/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Action,
  type WorkflowRun,
  type WorkflowRunFull,
} from "@hexabot-ai/types";
import { IconButton, Stack, Tooltip } from "@mui/material";
import { Ban, CheckCircle, Eye, PencilLine, XCircle } from "lucide-react";

import { useOperatorDialogs } from "@/components/workflow-run-debugger/hooks/useOperatorDialogs";
import {
  getOperatorWaits,
  getRunDebuggerPath,
  isApprovalWait,
} from "@/components/workflow-run-debugger/operator.utils";
import { useAppRouter } from "@/hooks/useAppRouter";
import { useHasPermission } from "@/hooks/useHasPermission";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";

type PendingRunActionsProps = {
  run: WorkflowRun | WorkflowRunFull;
};

/**
 * Row actions of a pending run: resolve its first request, cancel it, or
 * open it in the debugger.
 */
export const PendingRunActions = ({ run }: PendingRunActionsProps) => {
  const { t } = useTranslate();
  const router = useAppRouter();
  const hasPermission = useHasPermission();
  const { openForWait, openCancel } = useOperatorDialogs();
  const canDecide = hasPermission(EntityType.WORKFLOW_RUN, Action.UPDATE);
  const [wait] = getOperatorWaits(run);
  const debuggerPath = getRunDebuggerPath(run);

  return (
    <Stack direction="row" alignItems="center" height="100%" spacing={0.5}>
      {canDecide && wait && isApprovalWait(wait) ? (
        <>
          <Tooltip title={t("button.approve")}>
            <IconButton
              size="small"
              color="success"
              aria-label={t("button.approve")}
              onClick={() => void openForWait(run, wait, "approve")}
            >
              <CheckCircle size={18} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("button.reject")}>
            <IconButton
              size="small"
              color="error"
              aria-label={t("button.reject")}
              onClick={() => void openForWait(run, wait, "reject")}
            >
              <XCircle size={18} />
            </IconButton>
          </Tooltip>
        </>
      ) : null}
      {canDecide && wait && !isApprovalWait(wait) ? (
        <Tooltip title={t("button.provide_input")}>
          <IconButton
            size="small"
            color="primary"
            aria-label={t("button.provide_input")}
            onClick={() => void openForWait(run, wait)}
          >
            <PencilLine size={18} />
          </IconButton>
        </Tooltip>
      ) : null}
      {canDecide ? (
        <Tooltip title={t("button.cancel_run")}>
          <IconButton
            size="small"
            aria-label={t("button.cancel_run")}
            onClick={() => void openCancel(run)}
          >
            <Ban size={18} />
          </IconButton>
        </Tooltip>
      ) : null}
      <Tooltip title={t("button.view")}>
        <span>
          <IconButton
            size="small"
            aria-label={t("button.view")}
            disabled={!debuggerPath}
            onClick={() => debuggerPath && router.push(debuggerPath)}
          >
            <Eye size={18} />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
};
