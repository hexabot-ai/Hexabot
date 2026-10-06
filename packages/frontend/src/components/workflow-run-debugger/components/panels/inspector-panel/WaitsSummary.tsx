/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WaitInfo } from "@hexabot-ai/agentic";
import { Chip, Stack, Typography } from "@mui/material";

import type { OverviewLabels } from "./overview.types";
import { SummaryItem } from "./SummaryItem";

type WaitsSummaryProps = {
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

export const WaitsSummary = ({ labels, waits }: WaitsSummaryProps) => (
  <SummaryItem
    label={labels.openWaits}
    value={
      <Stack spacing={1}>
        {waits.map((wait) => {
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
              {wait.reason ? (
                <Chip
                  size="small"
                  variant="outlined"
                  color="warning"
                  label={wait.reason}
                />
              ) : null}
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
