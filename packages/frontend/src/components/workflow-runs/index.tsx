/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowRunFull } from "@hexabot-ai/types";
import { Box } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { Activity, GalleryHorizontalEnd } from "lucide-react";
import { ComponentProps, useMemo } from "react";

import { ChipEntity } from "@/app-components/displays/ChipEntity";
import {
  ColumnActionType,
  useActionColumns,
} from "@/app-components/tables/columns/getColumns";
import { GenericDataGrid } from "@/app-components/tables/GenericDataGrid";
import { type Filter } from "@/app-components/tables/GenericFilters";
import { WorkflowBadgeWithTitle } from "@/app-components/workflow/WorkflowBadgeWithTitle";
import { WorkflowRunStatusBadge } from "@/app-components/workflow/WorkflowRunStatusBadge";
import {
  WORKFLOW_STATUS,
  WORKFLOW_TYPES,
} from "@/constants/workflow.constants";
import { useGetFromCache } from "@/hooks/crud/useGet";
import { useAppRouter } from "@/hooks/useAppRouter";
import { useQueryState } from "@/hooks/useQueryState";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType, Format } from "@/services/types";
import { formatDurationMs, getDateTimeFormatter } from "@/utils/date";

export const WorkflowRuns = ({
  hidedColumns = [],
  ...rest
}: {
  hidedColumns?: string[];
} & Partial<ComponentProps<typeof GenericDataGrid>>) => {
  const { t } = useTranslate();
  const router = useAppRouter();
  const getWorkflowFromCache = useGetFromCache(EntityType.WORKFLOW);
  const actionColumns = useActionColumns<WorkflowRunFull>(
    EntityType.WORKFLOW_RUN,
    [
      {
        action: ColumnActionType.View,
        onClick: (row) =>
          router.push(
            `/workflow/${row.workflow}/runs/${row.triggeredBy}/${row.id}`,
          ),
      },
    ],
    t("label.operations"),
  );
  const columns = useMemo(
    () =>
      [
        { field: "id", headerName: "ID", width: 100 },
        {
          minWidth: 140,
          field: "createdAt",
          headerName: t("label.triggered_at"),
          disableColumnMenu: true,
          resizable: false,
          headerAlign: "left",
          valueGetter: (value) =>
            t("datetime.created_at", getDateTimeFormatter(value)),
        },
        {
          flex: 1,
          minWidth: 200,
          field: "workflow.name",
          resizable: true,
          headerName: t("label.workflow"),
          disableColumnMenu: true,
          headerAlign: "left",
          renderCell: ({ row }) => {
            const workflowId = String(row.workflow);
            const workflow = getWorkflowFromCache(workflowId);

            if (!workflow) {
              return "-";
            }

            return (
              <Box height="100%" display="flex" alignItems="center">
                <WorkflowBadgeWithTitle workflow={workflow} />
              </Box>
            );
          },
        },
        {
          flex: 1,
          minWidth: 150,
          sortable: false,
          field: "triggeredBy",
          resizable: true,
          headerName: t("label.triggered_by"),
          disableColumnMenu: true,
          headerAlign: "left",
          renderCell: ({ row }) => {
            const subscriberId = String(row.triggeredBy);

            return (
              <ChipEntity
                id={subscriberId}
                key={subscriberId}
                field="firstName"
                entity={EntityType.SUBSCRIBER}
              />
            );
          },
        },
        {
          maxWidth: 120,
          field: "status",
          headerName: t("label.status"),
          disableColumnMenu: true,
          headerAlign: "left",
          renderCell: ({ row }) => (
            <Box height="100%" display="flex" alignItems="center">
              <WorkflowRunStatusBadge workflowRun={row} />
            </Box>
          ),
        },
        {
          maxWidth: 100,
          field: "duration",
          headerName: t("label.duration"),
          sortable: false,
          disableColumnMenu: true,
          headerAlign: "left",
          valueGetter: (_value, row) => formatDurationMs(row.duration),
        },
        {
          flex: 1,
          minWidth: 200,
          field: "error",
          headerName: t("label.error"),
          sortable: false,
          disableColumnMenu: true,
          headerAlign: "left",
          valueGetter: (_value, row) => row.error || "-",
        },
        actionColumns,
      ] satisfies GridColDef<WorkflowRunFull>[],
    [t],
  );
  const [name, setName] = useQueryState("name");
  const [subscriber, setSubscriber] = useQueryState("subscriber");
  const [type, setType, defaultType] = useQueryState("type", "all");
  const [workflowRunStatus, setWorkflowRunStatus, defaultWorkflowRunStatus] =
    useQueryState("status", "all");
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
        entity: EntityType.SUBSCRIBER,
        type: "entitySelectFilter",
        field: "id",
        labelKey: "firstName",
        value: subscriber,
        label: t("title.subscribers"),
        onChange: setSubscriber,
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
      {
        entity: EntityType.WORKFLOW_RUN,
        type: "enumFilter",
        field: "status",
        value: workflowRunStatus,
        label: t("label.status"),
        defaultOption: {
          icon: GalleryHorizontalEnd,
          title: `${t("label.all")} ${t("label.status")}`,
          defaultValue: defaultWorkflowRunStatus,
        },
        typeInfo: WORKFLOW_STATUS,
        onChange: setWorkflowRunStatus,
      },
    ],
    [setName, setType, setWorkflowRunStatus, setSubscriber],
  );

  return (
    <GenericDataGrid
      filters={filters}
      headerIcon={Activity}
      headerI18nTitle="title.workflow_runs"
      {...rest}
      entity={EntityType.WORKFLOW_RUN}
      format={Format.FULL}
      columns={columns
        .filter(({ field }) => !hidedColumns.includes(field))
        .map((c) => (hidedColumns.length ? { ...c, sortable: false } : c))}
      searchParams={{
        $or: ["status", "error"],
        syncUrl: true,
        $eq: [
          {
            status: workflowRunStatus,
            "workflow.name": name,
            "workflow.type": type,
            "triggeredBy.id": subscriber,
          },
        ],
      }}
    />
  );
};
