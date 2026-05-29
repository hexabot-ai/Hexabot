/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Workflow } from "@hexabot-ai/types";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import { FC, useEffect, useMemo, useState } from "react";

import { useFind } from "@/hooks/crud/useFind";
import { useGetFromCache } from "@/hooks/crud/useGet";
import { EntityType, Format } from "@/services/types";

import { useWorkflowRunLiveUpdates } from "../hooks/useWorkflowRunLiveUpdates";

import { RunHeader } from "./header/RunHeader";
import { InspectorPanel } from "./panels/inspector-panel/InspectorPanel";
import { StepTracePanel } from "./panels/step-trace-panel";

type WorkflowRunDebuggerProps = {
  initiatorId?: string;
  runId?: string;
  workflow?: Workflow;
  workflowInput?: Record<string, unknown>;
};

export const WorkflowRunDebugger: FC<WorkflowRunDebuggerProps> = ({
  initiatorId,
  runId,
  workflow,
  workflowInput,
}) => {
  useWorkflowRunLiveUpdates({
    workflowId: workflow?.id,
    initiatorId,
  });

  const getWorkflowVersionFromCache = useGetFromCache(
    EntityType.WORKFLOW_VERSION,
  );
  const { data: workflowRuns = [], isFetching } = useFind(
    { entity: EntityType.WORKFLOW_RUN, format: Format.FULL },
    {
      params: {
        where: {
          ["workflow.id"]: workflow?.id,
          ["triggeredBy.id"]: initiatorId,
        },
      },
      hasCount: false,
      initialSortState: [
        {
          field: "createdAt",
          sort: "desc",
        },
      ],
    },
    {
      enabled: Boolean(workflow?.id || initiatorId),
    },
  );
  const latestRun = workflowRuns[0];
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(runId);
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!workflowRuns.length) {
      if (!runId) {
        setSelectedRunId(undefined);
      }

      return;
    }

    const isSelectedStillAvailable = workflowRuns.some(
      (run) => run.id === selectedRunId,
    );

    if (!isSelectedStillAvailable && !runId) {
      setSelectedRunId(workflowRuns[0]?.id);
    }
  }, [runId, selectedRunId, workflowRuns]);

  useEffect(() => {
    if (runId) {
      setSelectedRunId(runId);
      setSelectedStepId(undefined);
    }
  }, [runId]);

  const selectedRun = useMemo(
    () => workflowRuns.find((run) => run.id === selectedRunId) ?? latestRun,
    [latestRun, selectedRunId, workflowRuns],
  );
  const selectedStep = useMemo(() => {
    if (!selectedStepId) return null;

    return selectedRun?.stepLog?.[selectedStepId] ?? null;
  }, [selectedRun?.stepLog, selectedStepId]);

  useEffect(() => {
    if (runId) return;
    // New run
    setSelectedRunId(latestRun?.id);
    setSelectedStepId(undefined);
  }, [latestRun?.id, runId]);

  useEffect(() => {
    setSelectedStepId(undefined);
  }, [selectedRun?.id]);

  useEffect(() => {
    if (!selectedStepId) return;
    if (!selectedRun?.stepLog?.[selectedStepId]) {
      setSelectedStepId(undefined);
    }
  }, [latestRun?.stepLog, selectedStepId]);

  const handleSelectStep = (stepId: string) => {
    setSelectedStepId((current) => (current === stepId ? undefined : stepId));
  };
  const selectedWorkflowVersion = selectedRun?.workflowVersion
    ? getWorkflowVersionFromCache(selectedRun?.workflowVersion)
    : null;

  return (
    <Stack direction="column" gap={1} flex={1} overflow="hidden">
      <RunHeader
        workflowRuns={workflowRuns}
        isFetching={isFetching}
        selectedRun={selectedRun}
        workflow={workflow ?? null}
        workflowInput={workflowInput}
        workflowVersion={selectedWorkflowVersion ?? null}
        onSelectRun={setSelectedRunId}
      />
      <Grid container spacing={1} flex={1} overflow="hidden">
        <StepTracePanel
          stepLog={selectedRun?.stepLog ?? null}
          selectedStepId={selectedStepId}
          onSelectStep={handleSelectStep}
        />
        <InspectorPanel run={selectedRun ?? null} step={selectedStep} />
      </Grid>
    </Stack>
  );
};
