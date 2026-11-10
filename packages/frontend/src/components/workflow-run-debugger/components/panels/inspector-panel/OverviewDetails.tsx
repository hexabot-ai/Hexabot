/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WaitInfo } from "@hexabot-ai/agentic";
import type { WorkflowRun } from "@hexabot-ai/types";
import { Divider } from "@mui/material";

import { DataSummaryGrid } from "./DataSummaryGrid";
import { ErrorSummary } from "./ErrorSummary";
import type { OverviewLabels } from "./overview.types";
import { WaitsSummary } from "./WaitsSummary";

export type OverviewDetailsProps = {
  run: WorkflowRun | null;
  waits: WaitInfo[];
  labels: OverviewLabels;
  inputSummary: string;
  contextSummary: string;
  outputSummary: string;
  errorSummary: string;
  hasError: boolean;
};

/**
 * Open waits, data and error sections shared by the run and step overviews.
 */
export const OverviewDetails = ({
  run,
  waits,
  labels,
  inputSummary,
  contextSummary,
  outputSummary,
  errorSummary,
  hasError,
}: OverviewDetailsProps) => (
  <>
    {waits.length > 0 ? (
      <>
        <Divider />
        <WaitsSummary run={run} labels={labels} waits={waits} />
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
  </>
);
