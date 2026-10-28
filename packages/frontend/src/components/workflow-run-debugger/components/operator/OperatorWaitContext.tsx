/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WaitInfo } from "@hexabot-ai/agentic";
import { Stack, Typography } from "@mui/material";

import { useGetFromCache } from "@/hooks/crud/useGet";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";
import { formatSmartDate } from "@/utils/date";

import type { OperatorWaitView } from "../../operator.utils";
import { resolveEntityId } from "../../utils";

import { WaitDetails } from "./WaitDetails";
import { WaitReasonChip } from "./WaitReasonChip";

type OperatorWaitContextProps = {
  run: {
    workflow?: string | { id?: string; name?: string } | null;
    suspendedAt?: Date | string | null;
  };
  wait: WaitInfo;
  view: OperatorWaitView | null;
};

/**
 * What an admin decides on: the workflow and step that wait, since when,
 * the request message and its details.
 */
export const OperatorWaitContext = ({
  run,
  wait,
  view,
}: OperatorWaitContextProps) => {
  const { t, i18n } = useTranslate();
  const getWorkflowFromCache = useGetFromCache(EntityType.WORKFLOW);
  const workflowId = resolveEntityId(run.workflow);
  const workflowName =
    (workflowId && getWorkflowFromCache(workflowId)?.name) ||
    (typeof run.workflow === "object" ? run.workflow?.name : undefined);
  const meta = [
    workflowName,
    wait.step.name,
    run.suspendedAt
      ? t("label.waiting_since_date", {
          0: formatSmartDate(new Date(run.suspendedAt), i18n.language),
        })
      : undefined,
  ].filter(Boolean);

  return (
    <Stack spacing={1.5}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
      >
        <WaitReasonChip reason={wait.reason} />
        <Typography variant="caption" color="text.secondary">
          {meta.join(" · ")}
        </Typography>
      </Stack>
      <Typography
        variant="body1"
        fontWeight={500}
        sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {view?.message || t("message.operator_wait_no_message")}
      </Typography>
      {view?.details && Object.keys(view.details).length > 0 ? (
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary">
            {t("label.details")}
          </Typography>
          <WaitDetails details={view.details} />
        </Stack>
      ) : null}
    </Stack>
  );
};
