/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WaitInfo } from "@hexabot-ai/agentic";
import type { WorkflowRun } from "@hexabot-ai/types";
import { Divider, Stack } from "@mui/material";

import { WorkflowRunStatusBadge } from "@/app-components/workflow/WorkflowRunStatusBadge";

import { DataSummaryGrid } from "./DataSummaryGrid";
import { ErrorSummary } from "./ErrorSummary";
import type { OverviewLabels } from "./overview.types";
import { SummaryGrid } from "./SummaryGrid";
import { SummaryItem } from "./SummaryItem";
import { WaitsSummary } from "./WaitsSummary";

type RunOverviewProps = {
  run: WorkflowRun;
  waits: WaitInfo[];
  labels: OverviewLabels;
  triggeredAtLabel: string;
  triggeredByLabel: string;
  durationLabel: string;
  inputSummary: string;
  contextSummary: string;
  outputSummary: string;
  errorSummary: string;
  hasError: boolean;
};

export const RunOverview = ({
  run,
  waits,
  labels,
  triggeredAtLabel,
  triggeredByLabel,
  durationLabel,
  inputSummary,
  contextSummary,
  outputSummary,
  errorSummary,
  hasError,
}: RunOverviewProps) => (
  <Stack spacing={2}>
    <SummaryGrid
      columns={{
        xs: "1fr",
        sm: "repeat(2, minmax(0, 1fr))",
      }}
    >
      <SummaryItem
        label={labels.status}
        value={<WorkflowRunStatusBadge workflowRun={run} />}
      />
      <SummaryItem label={labels.triggeredAt} value={triggeredAtLabel} />
      <SummaryItem label={labels.triggeredBy} value={triggeredByLabel} />
      <SummaryItem label={labels.duration} value={durationLabel} />
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
