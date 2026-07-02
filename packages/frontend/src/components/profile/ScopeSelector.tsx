/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Action } from "@hexabot-ai/types";
import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  InputAdornment,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { useTranslate } from "@/hooks/useTranslate";

import {
  API_TOKEN_ACTIONS,
  ApiTokenScopeGroup,
  scopeKeyOf,
} from "./api-tokens.utils";

type ScopeSelectorProps = {
  groups: ApiTokenScopeGroup[];
  selectedKeys: Set<string>;
  selectedCount: number;
  totalCount: number;
  isLoading: boolean;
  error?: string;
  onToggleScope: (model: string, action: Action) => void;
  onToggleModel: (group: ApiTokenScopeGroup) => void;
  onSelectAll: () => void;
  onClear: () => void;
};

export const ScopeSelector = ({
  groups,
  selectedKeys,
  selectedCount,
  totalCount,
  isLoading,
  error,
  onToggleScope,
  onToggleModel,
  onSelectAll,
  onClear,
}: ScopeSelectorProps) => {
  const { t } = useTranslate();
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const visibleGroups = useMemo(
    () =>
      normalizedSearch
        ? groups.filter((group) =>
            group.model.toLowerCase().includes(normalizedSearch),
          )
        : groups,
    [groups, normalizedSearch],
  );

  if (isLoading) {
    return (
      <Stack alignItems="center" py={2}>
        <CircularProgress size={24} />
      </Stack>
    );
  }

  if (totalCount === 0) {
    return <Alert severity="info">{t("message.api_token_no_scopes")}</Alert>;
  }

  return (
    <Stack gap={1}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        gap={1}
        alignItems={{ sm: "center" }}
        justifyContent="space-between"
      >
        <TextField
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("label.api_token_scope_search")}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={16} />
                </InputAdornment>
              ),
            },
          }}
          sx={{ flex: 1 }}
        />
        <Stack direction="row" gap={1}>
          <Button
            size="small"
            onClick={onSelectAll}
            disabled={selectedCount === totalCount}
          >
            {t("button.select_all")}
          </Button>
          <Button
            size="small"
            color="inherit"
            onClick={onClear}
            disabled={selectedCount === 0}
          >
            {t("button.clear")}
          </Button>
        </Stack>
      </Stack>

      <Typography variant="caption" color={error ? "error" : "text.secondary"}>
        {error || t("label.api_token_scope_selected", { 0: selectedCount })}
      </Typography>

      <TableContainer
        sx={{
          border: (theme) => `1px solid ${theme.palette.divider}`,
          borderRadius: 1,
          maxHeight: 300,
        }}
      >
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>{t("label.model")}</TableCell>
              {API_TOKEN_ACTIONS.map((action) => (
                <TableCell key={action} align="center" padding="checkbox">
                  {t(`label.${action}`)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleGroups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={API_TOKEN_ACTIONS.length + 1}>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    align="center"
                  >
                    {t("message.no_data_to_display")}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              visibleGroups.map((group) => {
                const modelKeys = group.actions.map((action) =>
                  scopeKeyOf(group.model, action),
                );
                const selectedInModel = modelKeys.filter((key) =>
                  selectedKeys.has(key),
                ).length;
                const allSelected = selectedInModel === modelKeys.length;

                return (
                  <TableRow key={group.model} hover>
                    <TableCell>
                      <Stack direction="row" alignItems="center" gap={0.5}>
                        <Checkbox
                          size="small"
                          checked={allSelected}
                          indeterminate={selectedInModel > 0 && !allSelected}
                          onChange={() => onToggleModel(group)}
                          slotProps={{ input: { "aria-label": group.model } }}
                        />
                        <Typography variant="body2" fontFamily="monospace">
                          {group.model}
                        </Typography>
                      </Stack>
                    </TableCell>
                    {API_TOKEN_ACTIONS.map((action) => {
                      const key = scopeKeyOf(group.model, action);

                      return (
                        <TableCell
                          key={action}
                          align="center"
                          padding="checkbox"
                        >
                          {group.actions.includes(action) ? (
                            <Checkbox
                              size="small"
                              checked={selectedKeys.has(key)}
                              onChange={() =>
                                onToggleScope(group.model, action)
                              }
                              slotProps={{ input: { "aria-label": key } }}
                            />
                          ) : (
                            <Typography component="span" color="text.disabled">
                              —
                            </Typography>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
};
