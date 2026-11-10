/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { StepExecutionRecord, WaitInfo } from "@hexabot-ai/agentic";
import type { WorkflowRun } from "@hexabot-ai/types";
import { Stack, Typography } from "@mui/material";

import { ActionStatusIndicator } from "../step-trace-panel/ActionStatusIndicator";

import type { OverviewLabels } from "./overview.types";
import { OverviewDetails } from "./OverviewDetails";
import { SummaryGrid } from "./SummaryGrid";
import { SummaryItem } from "./SummaryItem";

type StepOverviewProps = {
  run: WorkflowRun | null;
  step: StepExecutionRecord;
  waits: WaitInfo[];
  labels: OverviewLabels;
  stepStatusLabel: string;
  stepDurationLabel: string;
  inputSummary: string;
  contextSummary: string;
  outputSummary: string;
  errorSummary: string;
  hasError: boolean;
};

export const StepOverview = ({
  run,
  step,
  waits,
  labels,
  stepStatusLabel,
  stepDurationLabel,
  inputSummary,
  contextSummary,
  outputSummary,
  errorSummary,
  hasError,
}: StepOverviewProps) => (
  <Stack spacing={2}>
    <SummaryGrid
      columns={{
        xs: "1fr",
        sm: "repeat(2, minmax(0, 1fr))",
      }}
    >
      <SummaryItem label={labels.name} value={step.name ?? labels.none} />
      <SummaryItem
        label={labels.status}
        value={
          <Stack direction="row" spacing={1} alignItems="center">
            <ActionStatusIndicator status={step.status} size={18} />
            <Typography variant="body2" fontWeight={500}>
              {stepStatusLabel}
            </Typography>
          </Stack>
        }
      />
      <SummaryItem label={labels.duration} value={stepDurationLabel} />
    </SummaryGrid>
    <OverviewDetails
      run={run}
      waits={waits}
      labels={labels}
      inputSummary={inputSummary}
      contextSummary={contextSummary}
      outputSummary={outputSummary}
      errorSummary={errorSummary}
      hasError={hasError}
    />
  </Stack>
);
