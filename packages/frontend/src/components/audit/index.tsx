/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action, type AuditLog } from "@hexabot-ai/types";
import { Box, Chip } from "@mui/material";
import type { GridColDef } from "@mui/x-data-grid";
import { ScrollText } from "lucide-react";
import { useMemo, useState } from "react";

import {
  ColumnActionType,
  useActionColumns,
} from "@/app-components/tables/columns/getColumns";
import { useTimestampColumns } from "@/app-components/tables/columns/useTimestampColumns";
import { GenericDataGrid } from "@/app-components/tables/GenericDataGrid";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";

import {
  formatAuditActor,
  formatAuditResource,
  getAuditStatusMeta,
} from "./audit-display.utils";
import { AuditLogDetailsDrawer } from "./AuditLogDetailsDrawer";

const AUDIT_LOG_SEARCH_FIELDS = [
  "resourceId",
  "resourceType",
  "resourceLabel",
  "operationId",
  "operationType",
  "operationStatus",
  "actorId",
  "actorType",
  "actorLabel",
  "actorIp",
  "requestId",
  "requestMethod",
  "requestPath",
] satisfies Array<keyof AuditLog>;

export const Audit = () => {
  const { t } = useTranslate();
  const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLog | null>(
    null,
  );
  const actionColumns = useActionColumns<AuditLog>(
    EntityType.AUDIT_LOG,
    [
      {
        action: ColumnActionType.View,
        onClick: (row) => setSelectedAuditLog(row),
        requires: [Action.READ],
      },
    ],
    t("label.operations"),
  );
  const timestampColumns = useTimestampColumns<AuditLog>("createdAt");
  const columns = useMemo(
    () =>
      [
        { field: "id", headerName: "ID", width: 100 },
        ...timestampColumns,
        {
          minWidth: 140,
          field: "operationStatus",
          headerName: t("label.operation_status"),
          disableColumnMenu: true,
          headerAlign: "left",
          renderCell: ({ row }) => {
            const statusMeta = getAuditStatusMeta(row.operationStatus);

            return (
              <Box height="100%" display="flex" alignItems="center">
                <Chip
                  size="small"
                  color={statusMeta.tone}
                  label={t(statusMeta.labelKey)}
                />
              </Box>
            );
          },
        },
        {
          minWidth: 150,
          field: "operationType",
          headerName: t("label.operation_type"),
          disableColumnMenu: true,
          headerAlign: "left",
        },
        {
          minWidth: 220,
          field: "operationId",
          headerName: t("label.operation_id"),
          disableColumnMenu: true,
          headerAlign: "left",
        },
        {
          minWidth: 240,
          field: "resourceLabel",
          headerName: t("label.resource"),
          disableColumnMenu: true,
          headerAlign: "left",
          renderCell: ({ row }) => formatAuditResource(row),
        },
        {
          minWidth: 220,
          field: "actorLabel",
          headerName: t("label.actor"),
          disableColumnMenu: true,
          headerAlign: "left",
          renderCell: ({ row }) => formatAuditActor(row),
        },
        {
          minWidth: 120,
          field: "requestMethod",
          headerName: t("label.request_method"),
          disableColumnMenu: true,
          headerAlign: "left",
          valueGetter: (value) => value || "-",
        },
        {
          minWidth: 240,
          field: "requestPath",
          headerName: t("label.request_path"),
          disableColumnMenu: true,
          headerAlign: "left",
          valueGetter: (value) => value || "-",
        },
        actionColumns,
      ] satisfies GridColDef<AuditLog>[],
    [actionColumns, t, timestampColumns],
  );

  return (
    <>
      <GenericDataGrid
        entity={EntityType.AUDIT_LOG}
        columns={columns}
        headerIcon={ScrollText}
        headerI18nTitle="title.audit_trail"
        initialSortState={[{ field: "createdAt", sort: "desc" }]}
        searchParams={{
          $or: AUDIT_LOG_SEARCH_FIELDS,
          syncUrl: true,
        }}
      />
      <AuditLogDetailsDrawer
        auditLog={selectedAuditLog}
        onClose={() => setSelectedAuditLog(null)}
      />
    </>
  );
};
