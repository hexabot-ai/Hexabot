/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus } from "@hexabot-ai/agentic";
import type { WorkflowRun, WorkflowRunFull } from "@hexabot-ai/types";

import { BadgeWithTitle } from "@/app-components/displays/Badge";
import {
  WORKFLOW_RUN_AWAITING_OPERATOR_STATUS,
  WORKFLOW_STATUS,
} from "@/constants/workflow.constants";

export type WorkflowRunStatusBadgeProps = {
  workflowRun?: WorkflowRun | WorkflowRunFull | null;
};

export const WorkflowRunStatusBadge = ({
  workflowRun,
}: WorkflowRunStatusBadgeProps) => {
  if (!workflowRun) {
    return null;
  }

  const status =
    (workflowRun?.status as EWorkflowRunStatus) ?? EWorkflowRunStatus.IDLE;
  const isAwaitingOperator =
    status === EWorkflowRunStatus.SUSPENDED && workflowRun.awaitingOperator;
  const { key: _key, ...badgeRest } = isAwaitingOperator
    ? WORKFLOW_RUN_AWAITING_OPERATOR_STATUS
    : (WORKFLOW_STATUS[status] ?? WORKFLOW_STATUS[EWorkflowRunStatus.IDLE]);
  const title = workflowRun?.status ?? status;

  return (
    <BadgeWithTitle
      {...badgeRest}
      title={title}
      isLoading={workflowRun?.status === EWorkflowRunStatus.RUNNING}
    />
  );
};
