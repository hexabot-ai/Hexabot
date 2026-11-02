/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { StepExecutionRecord, WaitInfo } from "@hexabot-ai/agentic";
import type { WorkflowRun } from "@hexabot-ai/types";

import { NoDataMessage } from "./NoDataMessage";
import type { OverviewLabels } from "./overview.types";
import { RunOverview } from "./RunOverview";
import { StepOverview } from "./StepOverview";

type OverviewContentProps = {
  run: WorkflowRun | null;
  step: StepExecutionRecord | null;
  waits: WaitInfo[];
  labels: OverviewLabels;
  triggeredAtLabel: string;
  triggeredByLabel: string;
  durationLabel: string;
  stepStatusLabel: string;
  stepDurationLabel: string;
  inputSummary: string;
  contextSummary: string;
  outputSummary: string;
  errorSummary: string;
  hasError: boolean;
};

export const OverviewContent = ({
  run,
  step,
  waits,
  labels,
  triggeredAtLabel,
  triggeredByLabel,
  durationLabel,
  stepStatusLabel,
  stepDurationLabel,
  inputSummary,
  contextSummary,
  outputSummary,
  errorSummary,
  hasError,
}: OverviewContentProps) => {
  if (!run && !step) {
    return <NoDataMessage label={labels.noData} />;
  }

  if (step) {
    return (
      <StepOverview
        run={run}
        step={step}
        waits={waits}
        labels={labels}
        stepStatusLabel={stepStatusLabel}
        stepDurationLabel={stepDurationLabel}
        inputSummary={inputSummary}
        contextSummary={contextSummary}
        outputSummary={outputSummary}
        errorSummary={errorSummary}
        hasError={hasError}
      />
    );
  }

  if (!run) {
    return <NoDataMessage label={labels.noData} />;
  }

  return (
    <RunOverview
      run={run}
      waits={waits}
      labels={labels}
      triggeredAtLabel={triggeredAtLabel}
      triggeredByLabel={triggeredByLabel}
      durationLabel={durationLabel}
      inputSummary={inputSummary}
      contextSummary={contextSummary}
      outputSummary={outputSummary}
      errorSummary={errorSummary}
      hasError={hasError}
    />
  );
};
