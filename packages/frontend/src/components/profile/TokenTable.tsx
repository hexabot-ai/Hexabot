/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { ApiTokenScope } from "@hexabot-ai/types";
import {
  Chip,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import type { ChipProps } from "@mui/material";
import { Trash2 } from "lucide-react";
import { useMemo } from "react";

import { useTranslate } from "@/hooks/useTranslate";

import {
  ApiTokenStatus,
  formatOptionalDate,
  formatScopeLabel,
  getApiTokenStatus,
  getScopeKey,
} from "./api-tokens.utils";

export const statusColorByStatus: Record<ApiTokenStatus, ChipProps["color"]> = {
  active: "success",
  expired: "warning",
  revoked: "default",
};

export type TokenRowData = {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt?: Date | string | null;
  expiresAt?: Date | string | null;
  lastUsedAt?: Date | string | null;
  revokedAt?: Date | string | null;
  scopes?: ApiTokenScope[];
};

type TokenTableProps = {
  ariaLabel: string;
  tokens: TokenRowData[];
  showScopes: boolean;
  isFetching: boolean;
  isRevoking: boolean;
  onRevoke: (token: TokenRowData) => void;
};

export const TokenTable = ({
  ariaLabel,
  tokens,
  showScopes,
  isFetching,
  isRevoking,
  onRevoke,
}: TokenTableProps) => {
  const { t, i18n } = useTranslate();
  const locale = i18n.resolvedLanguage || i18n.language;
  const rows = useMemo(
    () =>
      tokens.map((token) => ({
        token,
        status: getApiTokenStatus(token),
      })),
    [tokens],
  );
  const formatDate = (date: TokenRowData["createdAt"]) =>
    formatOptionalDate(date, locale) ?? t("label.never");

  return (
    <TableContainer>
      <Table size="small" aria-label={ariaLabel}>
        <TableHead>
          <TableRow>
            <TableCell>{t("label.name")}</TableCell>
            <TableCell>{t("label.token_prefix")}</TableCell>
            <TableCell>{t("label.createdAt")}</TableCell>
            <TableCell>{t("label.expires_at")}</TableCell>
            <TableCell>{t("label.last_used_at")}</TableCell>
            {showScopes ? <TableCell>{t("label.scopes")}</TableCell> : null}
            <TableCell>{t("label.status")}</TableCell>
            <TableCell align="right">{t("label.operations")}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(({ token, status }) => (
            <TableRow key={token.id}>
              <TableCell>{token.name}</TableCell>
              <TableCell>
                <Typography
                  component="span"
                  fontFamily="monospace"
                  variant="body2"
                >
                  {token.tokenPrefix}
                </Typography>
              </TableCell>
              <TableCell>{formatDate(token.createdAt)}</TableCell>
              <TableCell>{formatDate(token.expiresAt)}</TableCell>
              <TableCell>{formatDate(token.lastUsedAt)}</TableCell>
              {showScopes ? (
                <TableCell>
                  {token.scopes?.length ? (
                    <Tooltip
                      title={
                        <Stack>
                          {token.scopes.map((scope) => (
                            <span key={getScopeKey(scope)}>
                              {formatScopeLabel(scope)}
                            </span>
                          ))}
                        </Stack>
                      }
                    >
                      <Chip
                        size="small"
                        variant="outlined"
                        label={t("label.api_token_scope_count", {
                          count: token.scopes.length,
                        })}
                      />
                    </Tooltip>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t("label.none")}
                    </Typography>
                  )}
                </TableCell>
              ) : null}
              <TableCell>
                <Chip
                  color={statusColorByStatus[status]}
                  label={t(`label.api_token_status_${status}`)}
                  size="small"
                  variant={status === "active" ? "filled" : "outlined"}
                />
              </TableCell>
              <TableCell align="right">
                <Tooltip title={t("button.revoke")}>
                  <span>
                    <IconButton
                      aria-label={t("button.revoke")}
                      color="error"
                      disabled={status !== "active" || isRevoking || isFetching}
                      onClick={() => onRevoke(token)}
                      size="small"
                    >
                      <Trash2 size={18} />
                    </IconButton>
                  </span>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};
