/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus } from "@hexabot-ai/agentic";
import { Action, WorkflowType } from "@hexabot-ai/types";
import type { Workflow, WorkflowRun } from "@hexabot-ai/types";
import { Button, Stack } from "@mui/material";
import { Ban, PlayCircle } from "lucide-react";

import { useHasPermission } from "@/hooks/useHasPermission";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";

import { useOperatorDialogs } from "../../hooks/useOperatorDialogs";
import { useRunWorkflow } from "../../hooks/useRunWorkflow";

type RunActionsProps = {
  workflow?: Workflow | null;
  selectedRun?: WorkflowRun;
};

// Manual workflows are run from the trigger simulator panel, next to their
// input form; only scheduled workflows keep an ad-hoc trigger here. A
// suspended run, whatever it waits on, can be cancelled from here.
export const RunActions = ({ workflow, selectedRun }: RunActionsProps) => {
  const { t } = useTranslate();
  const hasPermission = useHasPermission();
  const { runWorkflow, isPending } = useRunWorkflow(workflow);
  const { openCancel } = useOperatorDialogs();
  const canRunNow = workflow?.type === WorkflowType.scheduled;
  const canCancel =
    selectedRun?.status === EWorkflowRunStatus.SUSPENDED &&
    hasPermission(EntityType.WORKFLOW_RUN, Action.UPDATE);

  if (!canRunNow && !canCancel) {
    return null;
  }

  return (
    <Stack
      direction="row"
      spacing={1}
      justifyContent="flex-start"
      alignItems="center"
    >
      {canRunNow ? (
        <Button
          size="small"
          variant="contained"
          startIcon={<PlayCircle size={18} />}
          aria-label={t("button.run_now")}
          onClick={() => runWorkflow(undefined)}
          disabled={!workflow?.id || isPending}
        >
          {t("button.run_now")}
        </Button>
      ) : null}
      {canCancel && selectedRun ? (
        <Button
          size="small"
          variant="outlined"
          color="error"
          startIcon={<Ban size={18} />}
          onClick={() => void openCancel(selectedRun)}
        >
          {t("button.cancel_run")}
        </Button>
      ) : null}
    </Stack>
  );
};
