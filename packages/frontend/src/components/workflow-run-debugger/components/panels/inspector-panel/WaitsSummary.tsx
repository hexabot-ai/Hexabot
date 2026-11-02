/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WaitInfo } from "@hexabot-ai/agentic";
import type { WorkflowRun } from "@hexabot-ai/types";
import { Stack, Typography } from "@mui/material";

import { isOperatorWait } from "../../../operator.utils";
import { OperatorWaitCard } from "../../operator/OperatorWaitCard";
import { WaitReasonChip } from "../../operator/WaitReasonChip";

import type { OverviewLabels } from "./overview.types";
import { SummaryItem } from "./SummaryItem";

type WaitsSummaryProps = {
  run: WorkflowRun | null;
  labels: Pick<
    OverviewLabels,
    "openWaits" | "waitPayloadRequired" | "waitPayloadOptional"
  >;
  waits: WaitInfo[];
};

const getPayloadLabel = (
  wait: WaitInfo,
  labels: WaitsSummaryProps["labels"],
): string | null => {
  if (!wait.accepts) return null;

  return wait.payloadOptional
    ? labels.waitPayloadOptional
    : labels.waitPayloadRequired;
};

/**
 * Open waits of a run (or of a step): the waits an admin resolves are shown
 * with their request and actions, the others (replies, called workflows) as
 * a compact row.
 */
export const WaitsSummary = ({ run, labels, waits }: WaitsSummaryProps) => (
  <SummaryItem
    label={labels.openWaits}
    value={
      <Stack spacing={1}>
        {waits.map((wait) => {
          if (run && isOperatorWait(wait)) {
            return <OperatorWaitCard key={wait.waitId} run={run} wait={wait} />;
          }

          const payloadLabel = getPayloadLabel(wait, labels);

          return (
            <Stack
              key={wait.waitId}
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <Typography variant="body2" fontWeight={500}>
                {wait.step.name}
              </Typography>
              <WaitReasonChip reason={wait.reason} />
              {payloadLabel ? (
                <Typography variant="caption" color="text.secondary">
                  {payloadLabel}
                </Typography>
              ) : null}
            </Stack>
          );
        })}
      </Stack>
    }
  />
);
