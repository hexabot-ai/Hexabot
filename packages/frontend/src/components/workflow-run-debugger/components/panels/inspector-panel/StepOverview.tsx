/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { StepExecutionRecord, WaitInfo } from "@hexabot-ai/agentic";
import { Divider, Stack, Typography } from "@mui/material";

import { ActionStatusIndicator } from "../step-trace-panel/ActionStatusIndicator";

import { DataSummaryGrid } from "./DataSummaryGrid";
import { ErrorSummary } from "./ErrorSummary";
import type { OverviewLabels } from "./overview.types";
import { SummaryGrid } from "./SummaryGrid";
import { SummaryItem } from "./SummaryItem";
import { WaitsSummary } from "./WaitsSummary";

type StepOverviewProps = {
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
    {waits.length > 0 ? (
      <>
        <Divider />
        <WaitsSummary labels={labels} waits={waits} />
      </>
    ) : null}
    <Divider />
    <DataSummaryGrid
      inputLabel={labels.input}
      contextLabel={labels.context}
      outputLabel={labels.output}
      inputSummary={inputSummary}
      contextSummary={contextSummary}
      outputSummary={outputSummary}
    />
    <Divider />
    <ErrorSummary
      label={labels.error}
      errorSummary={errorSummary}
      hasError={hasError}
    />
  </Stack>
);
