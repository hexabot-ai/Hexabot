/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Workflow } from "@hexabot-ai/types";
import { Box, Tab, Tabs, useMediaQuery, useTheme } from "@mui/material";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import { FC, useEffect, useMemo, useState } from "react";

import { useFind } from "@/hooks/crud/useFind";
import { useGet, useGetFromCache } from "@/hooks/crud/useGet";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType, Format } from "@/services/types";

import { useWorkflowRunLiveUpdates } from "../hooks/useWorkflowRunLiveUpdates";

import { RunHeader } from "./header/RunHeader";
import { InspectorPanel } from "./panels/inspector-panel/InspectorPanel";
import { StepTracePanel } from "./panels/step-trace-panel";

type MobilePanel = "steps" | "inspector";

type WorkflowRunDebuggerProps = {
  initiatorId?: string;
  runId?: string;
  workflow?: Workflow;
};

export const WorkflowRunDebugger: FC<WorkflowRunDebuggerProps> = ({
  initiatorId,
  runId,
  workflow,
}) => {
  const { t } = useTranslate();
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("lg"));
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("steps");

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
    setSelectedRunId(runId ?? latestRun?.id);
  }, [runId, latestRun?.id]);

  // Subscribe reactively to the selected run's item cache. The live-update hook
  // merges each step into `[item, WORKFLOW_RUN, runId]` via `setQueryData`, but
  // the `useFind` collection reads that cache non-reactively, so item merges
  // alone never re-render this component. Observing the item query here ensures
  // every incremental step update is reflected in real time.
  const { data: liveSelectedRun } = useGet(
    selectedRunId ?? "",
    { entity: EntityType.WORKFLOW_RUN, format: Format.FULL },
    { enabled: Boolean(selectedRunId) },
  );
  const selectedRun = useMemo(
    () =>
      liveSelectedRun ??
      workflowRuns.find((run) => run.id === selectedRunId) ??
      latestRun,
    [latestRun, liveSelectedRun, selectedRunId, workflowRuns],
  );
  const selectedStep = useMemo(() => {
    if (!selectedStepId) return null;

    return selectedRun?.stepLog?.[selectedStepId] ?? null;
  }, [selectedRun?.stepLog, selectedStepId]);

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
    const isSelecting = selectedStepId !== stepId;

    setSelectedStepId(isSelecting ? stepId : undefined);
    if (isSmallScreen && isSelecting) {
      setMobilePanel("inspector");
    }
  };
  const panelDisplay = (panel: MobilePanel) =>
    !isSmallScreen || mobilePanel === panel ? "contents" : "none";
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
        workflowVersion={selectedWorkflowVersion ?? null}
        onSelectRun={setSelectedRunId}
      />
      {isSmallScreen && (
        <Tabs
          value={mobilePanel}
          onChange={(_, v: MobilePanel) => setMobilePanel(v)}
          variant="fullWidth"
        >
          <Tab value="steps" label={t("label.step_trace.title")} />
          <Tab value="inspector" label={t("label.inspector")} />
        </Tabs>
      )}
      <Grid container spacing={1} flex={1} overflow="hidden">
        <Box sx={{ display: panelDisplay("steps") }}>
          <StepTracePanel
            stepLog={selectedRun?.stepLog ?? null}
            selectedStepId={selectedStepId}
            onSelectStep={handleSelectStep}
          />
        </Box>
        <Box sx={{ display: panelDisplay("inspector") }}>
          <InspectorPanel run={selectedRun ?? null} step={selectedStep} />
        </Box>
      </Grid>
    </Stack>
  );
};
