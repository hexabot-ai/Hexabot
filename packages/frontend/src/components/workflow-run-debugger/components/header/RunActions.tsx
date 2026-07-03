/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowType } from "@hexabot-ai/types";
import type { Workflow } from "@hexabot-ai/types";
import { Button, Stack } from "@mui/material";
import { PlayCircle } from "lucide-react";

import { useTranslate } from "@/hooks/useTranslate";

import { useRunWorkflow } from "../../hooks/useRunWorkflow";

type RunActionsProps = {
  workflow?: Workflow | null;
};

// Manual workflows are run from the trigger simulator panel, next to their
// input form; only scheduled workflows keep an ad-hoc trigger here.
export const RunActions = ({ workflow }: RunActionsProps) => {
  const { t } = useTranslate();
  const { runWorkflow, isPending } = useRunWorkflow(workflow);

  if (workflow?.type !== WorkflowType.scheduled) {
    return null;
  }

  return (
    <Stack
      direction="row"
      spacing={1}
      justifyContent="flex-start"
      alignItems="center"
    >
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
    </Stack>
  );
};
