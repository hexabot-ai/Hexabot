/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus } from "@hexabot-ai/agentic";
import type { WorkflowRun, WorkflowRunFull } from "@hexabot-ai/types";
import { Menu, MenuItem, Stack, Typography } from "@mui/material";

import { BadgeWithTitle } from "@/app-components/displays/Badge";
import { VersionChip } from "@/app-components/displays/VersionChip";
import { useGetFromCache } from "@/hooks/crud/useGet";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";

import {
  formatRunTimestamp,
  getStatusBadge,
  resolveEntityId,
} from "../../utils";

type RunHistoryMenuProps = {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  onSelectRun: (runId: string) => void;
  workflowRuns: Array<WorkflowRun | WorkflowRunFull>;
  isFetching: boolean;
  selectedRunId?: string;
};

export const RunHistoryMenu = ({
  anchorEl,
  open,
  onClose,
  onSelectRun,
  workflowRuns,
  isFetching,
  selectedRunId,
}: RunHistoryMenuProps) => {
  const { i18n, t } = useTranslate();
  const getWorkflowVersionFromCache = useGetFromCache(
    EntityType.WORKFLOW_VERSION,
  );

  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            minWidth: 300,
          },
        },
      }}
    >
      {isFetching && !workflowRuns.length ? (
        <MenuItem disabled>
          <Typography variant="body2" color="text.secondary">
            {t("message.loading_runs")}
          </Typography>
        </MenuItem>
      ) : workflowRuns.length ? (
        workflowRuns.map((run) => {
          const status =
            (run.status as EWorkflowRunStatus) ?? EWorkflowRunStatus.IDLE;
          const workflowVersionId = resolveEntityId(run.workflowVersion);
          const workflowVersion = workflowVersionId
            ? getWorkflowVersionFromCache(workflowVersionId)
            : undefined;
          const statusBadge = getStatusBadge(status, run.awaitingOperator);
          const statusLabel = run.status ?? status;
          const timestamp = formatRunTimestamp(i18n.language, run.createdAt);

          return (
            <MenuItem
              key={run.id}
              selected={run.id === selectedRunId}
              onClick={() => {
                onSelectRun(run.id);
                onClose();
              }}
            >
              <Stack
                direction="row"
                spacing={2}
                alignItems="center"
                justifyContent="space-between"
                sx={{ width: "100%" }}
              >
                <Stack spacing={0.25}>
                  <Typography variant="body2" fontWeight={600}>
                    {timestamp}
                  </Typography>
                  <VersionChip version={workflowVersion ?? null} />
                </Stack>
                <BadgeWithTitle {...statusBadge} title={statusLabel} />
              </Stack>
            </MenuItem>
          );
        })
      ) : (
        <MenuItem disabled>
          <Typography variant="body2" color="text.secondary">
            {t("message.no_runs_found")}
          </Typography>
        </MenuItem>
      )}
    </Menu>
  );
};
