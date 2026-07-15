/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Alert,
  Card,
  CardContent,
  Chip,
  List,
  ListItem,
  Stack,
  Typography,
} from "@mui/material";

import { useTranslate } from "@/hooks/useTranslate";
import { IMcpServerDiagnostics } from "@/types/mcp-server.types";
import { formatDurationMs, formatSmartDate } from "@/utils/date";

import { ServerDetailsCard } from "./ServerDetailsCard";
import { SummaryGrid } from "./SummaryGrid";
import { SummaryItem } from "./SummaryItem";
import { formatErrorMessage } from "./utils";

type DiagnosticsResultSectionProps = {
  diagnostics: IMcpServerDiagnostics;
};

export const DiagnosticsResultSection = ({
  diagnostics,
}: DiagnosticsResultSectionProps) => {
  const { t, i18n } = useTranslate();

  return (
    <Stack gap={2}>
      <Card variant="outlined">
        <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
          <SummaryGrid>
            <SummaryItem
              label={t("label.status")}
              value={
                <Chip
                  size="small"
                  label={
                    diagnostics.ok ? t("label.enabled") : t("label.disabled")
                  }
                  color={diagnostics.ok ? "success" : "error"}
                  variant={diagnostics.ok ? "filled" : "outlined"}
                />
              }
            />
            <SummaryItem
              label={t("label.latency")}
              value={formatDurationMs(diagnostics.latencyMs)}
            />
            <SummaryItem
              label={t("label.checked_at")}
              value={formatSmartDate(
                new Date(diagnostics.checkedAt),
                i18n.language,
              )}
            />
            <SummaryItem
              label={t("label.tool_count")}
              value={String(diagnostics.toolCount)}
            />
          </SummaryGrid>
        </CardContent>
      </Card>

      <ServerDetailsCard server={diagnostics.server} />

      <Card variant="outlined">
        <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
          <Stack spacing={1.25}>
            <Typography variant="subtitle2">
              {t("label.sampled_tools")}
            </Typography>
            {diagnostics.sampledToolNames.length ? (
              <List
                component="ul"
                dense
                disablePadding
                sx={{
                  pl: 2.5,
                  listStyleType: "disc",
                  "& .MuiListItem-root": {
                    display: "list-item",
                    py: 0.25,
                  },
                }}
              >
                {diagnostics.sampledToolNames.map((toolName) => (
                  <ListItem
                    key={toolName}
                    component="li"
                    disablePadding
                    disableGutters
                  >
                    <Typography variant="body2">{toolName}</Typography>
                  </ListItem>
                ))}
              </List>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {t("label.none")}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      {diagnostics.error ? (
        <Alert severity="error">
          <Typography
            component="pre"
            variant="body2"
            sx={{
              m: 0,
              whiteSpace: "pre-wrap",
              tabSize: 2,
              fontFamily: "monospace",
              overflowWrap: "anywhere",
            }}
          >
            {formatErrorMessage(diagnostics.error)}
          </Typography>
        </Alert>
      ) : null}
    </Stack>
  );
};
