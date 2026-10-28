/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WaitInfo } from "@hexabot-ai/agentic";
import type { WorkflowRun } from "@hexabot-ai/types";
import { Paper, Stack } from "@mui/material";
import { alpha } from "@mui/material/styles";

import { describeOperatorWait } from "../../operator.utils";

import { OperatorWaitActions } from "./OperatorWaitActions";
import { OperatorWaitContext } from "./OperatorWaitContext";

type OperatorWaitCardProps = {
  run: WorkflowRun;
  wait: WaitInfo;
};

/**
 * An open wait only an admin resolves, with its request and the buttons to
 * resolve it.
 */
export const OperatorWaitCard = ({ run, wait }: OperatorWaitCardProps) => (
  <Paper
    variant="outlined"
    sx={(theme) => ({
      p: 1.5,
      borderLeft: `4px solid ${theme.palette.warning.main}`,
      bgcolor: alpha(theme.palette.warning.main, 0.04),
    })}
  >
    <Stack spacing={1.5}>
      <OperatorWaitContext
        run={run}
        wait={wait}
        view={describeOperatorWait(wait)}
      />
      <Stack direction="row" justifyContent="flex-end">
        <OperatorWaitActions run={run} wait={wait} />
      </Stack>
    </Stack>
  </Paper>
);
