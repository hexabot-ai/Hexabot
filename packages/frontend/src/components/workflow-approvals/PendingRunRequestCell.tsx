/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowRun, WorkflowRunFull } from "@hexabot-ai/types";
import { Chip, Stack, Tooltip, Typography } from "@mui/material";

import { WaitReasonChip } from "@/components/workflow-run-debugger/components/operator/WaitReasonChip";
import {
  describeOperatorWait,
  getOperatorWaits,
} from "@/components/workflow-run-debugger/operator.utils";
import { useTranslate } from "@/hooks/useTranslate";

type PendingRunRequestCellProps = {
  run: WorkflowRun | WorkflowRunFull;
};

/**
 * First request a pending run makes, with the number of other requests.
 */
export const PendingRunRequestCell = ({ run }: PendingRunRequestCellProps) => {
  const { t } = useTranslate();
  const [wait, ...otherWaits] = getOperatorWaits(run);

  if (!wait) {
    return null;
  }

  const message =
    describeOperatorWait(wait)?.message ||
    t("message.operator_wait_no_message");

  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      height="100%"
      minWidth={0}
    >
      <WaitReasonChip reason={wait.reason} />
      <Tooltip title={message} placement="bottom-start">
        <Typography variant="body2" noWrap minWidth={0}>
          {message}
        </Typography>
      </Tooltip>
      {otherWaits.length > 0 ? (
        <Tooltip title={t("label.more_requests")}>
          <Chip size="small" label={`+${otherWaits.length}`} />
        </Tooltip>
      ) : null}
    </Stack>
  );
};
