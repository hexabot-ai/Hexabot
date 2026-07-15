/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { StepExecutionRecord } from "@hexabot-ai/agentic";
import type { WorkflowRun } from "@hexabot-ai/types";
import { Box, Tab, Tabs } from "@mui/material";
import { useMemo, useState } from "react";

import { JsonViewer } from "@/app-components/inputs/JsonViewer";
import { useGetFromCache } from "@/hooks/crud/useGet";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";
import { formatDurationMs } from "@/utils/date";

import { formatRunTimestamp, getInitiatorName } from "../../../utils";
import { getStepDuration } from "../step-trace-panel/utils";

import type { OverviewLabels } from "./overview.types";
import { OverviewContainer } from "./OverviewContainer";
import { OverviewContent } from "./OverviewContent";

const tabId = (index: number) => `inspector-tab-${index}`;
const panelId = (index: number) => `inspector-tabpanel-${index}`;

type InspectorTabsProps = {
  run: WorkflowRun | null;
  step?: StepExecutionRecord | null;
};

const formatDataSummary = (
  t: (key: string) => string,
  value?: unknown | null,
): string => {
  if (!value) return t("label.none");

  if (Array.isArray(value)) {
    return `${value.length} ${t("label.items")}`;
  }

  if (typeof value === "object") {
    return `${Object.keys(value).length} ${t("label.fields")}`;
  }

  return t("label.yes");
};

export const InspectorTabs = ({ run, step }: InspectorTabsProps) => {
  const { i18n, t } = useTranslate();
  const [value, setValue] = useState(0);
  const tabs = useMemo(
    () => [
      { key: "overview", label: t("label.inspector_tabs.overview") },
      { key: "input", label: t("label.inspector_tabs.input") },
      { key: "context", label: t("label.inspector_tabs.context") },
      { key: "output", label: t("label.inspector_tabs.output") },
      { key: "logs_errors", label: t("label.inspector_tabs.logs_errors") },
    ],
    [t],
  );
  const isStepSelected = Boolean(step);
  const inspectedInput = isStepSelected
    ? (step?.input ?? null)
    : (run?.input ?? null);
  const inspectedContext = isStepSelected
    ? (step?.context ?? null)
    : (run?.context ?? null);
  const inspectedOutput = isStepSelected
    ? (step?.output ?? null)
    : (run?.output ?? null);
  const inspectedError = isStepSelected
    ? (step?.error ?? null)
    : (run?.error ?? null);
  const panelData = useMemo(
    () => ({
      overview: {
        title: t("label.inspector_tabs.overview"),
        value: {
          input: inspectedInput,
          context: inspectedContext,
          output: inspectedOutput,
          error: inspectedError,
        },
      },
      input: {
        title: t("label.inspector_tabs.input"),
        value: inspectedInput,
      },
      context: {
        title: t("label.inspector_tabs.context"),
        value: inspectedContext,
      },
      output: {
        title: t("label.inspector_tabs.output"),
        value: inspectedOutput,
      },
      logs_errors: {
        title: t("label.inspector_tabs.logs_errors"),
        value: inspectedError,
      },
    }),
    [inspectedContext, inspectedError, inspectedInput, inspectedOutput, t],
  );
  const labels = useMemo<OverviewLabels>(
    () => ({
      none: t("label.none"),
      noData: t("label.no_data"),
      name: t("label.name"),
      status: t("label.status"),
      triggeredAt: t("label.triggered_at"),
      triggeredBy: t("label.triggered_by"),
      duration: t("label.duration"),
      error: t("label.error"),
      input: t("label.inspector_tabs.input"),
      context: t("label.inspector_tabs.context"),
      output: t("label.inspector_tabs.output"),
    }),
    [t],
  );
  const activeKey = tabs[value]?.key ?? "overview";
  const activePanel = panelData[activeKey as keyof typeof panelData];
  const getUserFromCache = useGetFromCache(EntityType.USER);
  const triggeredBy = run?.triggeredBy
    ? getUserFromCache(run?.triggeredBy)
    : null;
  const triggeredByLabel = getInitiatorName(triggeredBy);
  const triggeredAtLabel = formatRunTimestamp(i18n.language, run?.createdAt);
  const durationLabel = formatDurationMs(run?.duration);
  const inputSummary = formatDataSummary(t, inspectedInput);
  const contextSummary = formatDataSummary(t, inspectedContext);
  const outputSummary = formatDataSummary(t, inspectedOutput);
  const errorSummary = useMemo(() => {
    if (!inspectedError) return t("label.none");
    if (typeof inspectedError === "string") return inspectedError;
    if (typeof inspectedError === "object" && "message" in inspectedError) {
      const message = (inspectedError as { message?: string }).message;

      if (message) return message;
    }

    return t("label.yes");
  }, [inspectedError, t]);
  const hasError = Boolean(inspectedError);
  const stepDurationLabel = step
    ? formatDurationMs(getStepDuration(step))
    : "-";
  const statusLabels = useMemo(
    () => ({
      completed: t("label.step_trace.status_completed"),
      running: t("label.step_trace.status_running"),
      failed: t("label.step_trace.status_failed"),
      skipped: t("label.step_trace.status_skipped"),
      suspended: t("label.step_trace.status_suspended"),
      cancelled: t("label.step_trace.status_cancelled"),
      pending: t("label.step_trace.status_pending"),
    }),
    [t],
  );
  const stepStatusLabel = step ? statusLabels[step.status] : t("label.none");

  return (
    <Box display="flex" flexDirection="column" overflow="hidden" height="100%">
      <Tabs
        value={value}
        onChange={(_, nextValue) => setValue(nextValue)}
        allowScrollButtonsMobile
        aria-label={t("label.inspector")}
        sx={{ mx: 0.75 }}
      >
        {tabs.map((tab, index) => (
          <Tab
            key={tab.key}
            label={tab.label}
            id={tabId(index)}
            aria-controls={panelId(index)}
          />
        ))}
      </Tabs>
      <Box
        role="tabpanel"
        id={panelId(value)}
        aria-labelledby={tabId(value)}
        overflow="auto"
        height="100%"
      >
        {activeKey === "overview" ? (
          <OverviewContainer>
            <OverviewContent
              run={run}
              step={step ?? null}
              labels={labels}
              triggeredAtLabel={triggeredAtLabel}
              triggeredByLabel={triggeredByLabel}
              durationLabel={durationLabel}
              stepStatusLabel={stepStatusLabel}
              stepDurationLabel={stepDurationLabel}
              inputSummary={inputSummary}
              contextSummary={contextSummary}
              outputSummary={outputSummary}
              errorSummary={errorSummary}
              hasError={hasError}
            />
          </OverviewContainer>
        ) : (
          <JsonViewer value={activePanel.value} />
        )}
      </Box>
    </Box>
  );
};
