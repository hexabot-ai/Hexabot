/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowRun, WorkflowVersion, Workflow } from "@hexabot-ai/types";
import { Paper } from "@mui/material";
import Grid from "@mui/material/Grid";

import { RunActions } from "./RunActions";
import { RunMetaSummary } from "./RunMetaSummary";
import { RunStatusSummary } from "./RunStatusSummary";

type RunHeaderProps = {
  workflowRuns: Array<WorkflowRun>;
  isFetching: boolean;
  selectedRun?: WorkflowRun;
  workflow?: Workflow | null;
  workflowVersion?: WorkflowVersion | null;
  onSelectRun: (runId: string) => void;
};

export const RunHeader = ({
  workflowRuns,
  isFetching,
  selectedRun,
  workflow,
  workflowVersion,
  onSelectRun,
}: RunHeaderProps) => {
  return (
    <Paper
      sx={{
        p: 1,
        position: "sticky",
        top: 0,
        zIndex: (theme) => theme.zIndex.appBar - 1,
      }}
      variant="outlined"
    >
      <Grid container spacing={2} alignItems="center">
        <Grid
          container
          spacing={2}
          alignItems="center"
          size={{ xs: 12, lg: 9 }}
        >
          <RunActions workflow={workflow} />
          <RunStatusSummary
            workflowRuns={workflowRuns}
            isFetching={isFetching}
            selectedRun={selectedRun}
            onSelectRun={onSelectRun}
          />
          <RunMetaSummary
            workflow={workflow}
            workflowVersion={workflowVersion}
          />
        </Grid>
      </Grid>
    </Paper>
  );
};
