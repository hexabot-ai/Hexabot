/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowRunFull } from "@hexabot-ai/types";
import { Box, Tooltip, Typography } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { ClipboardCheck, GalleryHorizontalEnd } from "lucide-react";
import { useMemo } from "react";

import { GenericDataGrid } from "@/app-components/tables/GenericDataGrid";
import { type Filter } from "@/app-components/tables/GenericFilters";
import { WorkflowBadgeWithTitle } from "@/app-components/workflow/WorkflowBadgeWithTitle";
import {
  formatRunTimestamp,
  getInitiatorName,
} from "@/components/workflow-run-debugger/utils";
import { WORKFLOW_TYPES } from "@/constants/workflow.constants";
import { useGetFromCache } from "@/hooks/crud/useGet";
import { useQueryState } from "@/hooks/useQueryState";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType, Format } from "@/services/types";
import { formatSmartDate } from "@/utils/date";

import { PendingRunActions } from "./PendingRunActions";
import { PendingRunRequestCell } from "./PendingRunRequestCell";

/**
 * Runs waiting on an admin (`await_approval`, `suspend_workflow`), latest
 * suspension first, with the actions resolving them. Kept live by
 * `usePendingWorkflowRunsSync`.
 */
export const WorkflowApprovals = () => {
  const { t, i18n } = useTranslate();
  const getWorkflowFromCache = useGetFromCache(EntityType.WORKFLOW);
  const getUserFromCache = useGetFromCache(EntityType.USER);
  const [name, setName] = useQueryState("name");
  const [type, setType, defaultType] = useQueryState("type", "all");
  const columns = useMemo(
    () =>
      [
        { field: "id", headerName: "ID" },
        {
          flex: 1,
          minWidth: 180,
          field: "workflow",
          headerName: t("label.workflow"),
          sortable: false,
          renderCell: ({ row }) => {
            const workflow = getWorkflowFromCache(String(row.workflow));

            return workflow ? (
              <Box height="100%" display="flex" alignItems="center">
                <WorkflowBadgeWithTitle workflow={workflow} />
              </Box>
            ) : (
              "-"
            );
          },
        },
        {
          flex: 2,
          minWidth: 280,
          field: "request",
          headerName: t("label.request"),
          sortable: false,
          renderCell: ({ row }) => <PendingRunRequestCell run={row} />,
        },
        {
          flex: 1,
          minWidth: 150,
          field: "triggeredBy",
          headerName: t("label.triggered_by"),
          sortable: false,
          valueGetter: (_value, row) =>
            row.triggeredBy
              ? getInitiatorName(getUserFromCache(String(row.triggeredBy)))
              : "-",
        },
        {
          minWidth: 150,
          field: "suspendedAt",
          headerName: t("label.waiting_since"),
          renderCell: ({ row }) =>
            row.suspendedAt ? (
              <Box height="100%" display="flex" alignItems="center">
                <Tooltip
                  title={formatRunTimestamp(i18n.language, row.suspendedAt)}
                >
                  <Typography variant="body2">
                    {formatSmartDate(new Date(row.suspendedAt), i18n.language)}
                  </Typography>
                </Tooltip>
              </Box>
            ) : (
              "-"
            ),
        },
        {
          width: 220,
          field: "actions",
          headerName: t("label.operations"),
          sortable: false,
          renderCell: ({ row }) => <PendingRunActions run={row} />,
        },
      ] satisfies GridColDef<WorkflowRunFull>[],
    [getUserFromCache, getWorkflowFromCache, i18n.language, t],
  );
  const filters = useMemo<Filter[]>(
    () => [
      {
        entity: EntityType.WORKFLOW,
        type: "entitySelectFilter",
        field: "name",
        idKey: "name",
        labelKey: "type",
        value: name,
        label: t("label.workflow"),
        typeInfo: WORKFLOW_TYPES,
        onChange: setName,
      },
      {
        entity: EntityType.WORKFLOW,
        type: "enumFilter",
        field: "type",
        value: type,
        label: t("label.type"),
        defaultOption: {
          icon: GalleryHorizontalEnd,
          title: `${t("label.all")} ${t("label.types")}`,
          defaultValue: defaultType,
        },
        typeInfo: WORKFLOW_TYPES,
        onChange: setType,
      },
    ],
    [defaultType, name, setName, setType, t, type],
  );

  return (
    <GenericDataGrid
      entity={EntityType.WORKFLOW_RUN_PENDING}
      format={Format.FULL}
      headerIcon={ClipboardCheck}
      headerI18nTitle="title.workflow_approvals"
      headerI18nDescription="message.page_description.workflow_approvals"
      filters={filters}
      hasTextFilter={false}
      columns={columns}
      initialSortState={[{ field: "suspendedAt", sort: "desc" }]}
      searchParams={{
        syncUrl: true,
        $eq: [{ "workflow.name": name, "workflow.type": type }],
      }}
    />
  );
};
