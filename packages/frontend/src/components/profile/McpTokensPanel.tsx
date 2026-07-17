/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { McpToken } from "@hexabot-ai/types";
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { ChipProps } from "@mui/material";
import { AlertTriangle, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { useTanstackQueryClient } from "@/hooks/crud/useTanstack";
import {
  getApiClientQueryKey,
  useApiClientMutation,
  useApiClientQuery,
} from "@/hooks/useApiClient";
import { useDialogs } from "@/hooks/useDialogs";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import type { McpTokenCreateResponse } from "@/services/api.class";
import { writeToClipboard } from "@/utils/clipboard";

import {
  formatOptionalDate,
  getMcpTokenStatus,
  McpTokenStatus,
  toMcpTokenCreatePayload,
} from "./mcp-tokens.utils";

const statusColorByStatus: Record<McpTokenStatus, ChipProps["color"]> = {
  active: "success",
  expired: "warning",
  revoked: "default",
};
const McpTokenRevokeConfirmDialogBody = () => {
  const { t } = useTranslate();

  return (
    <Stack direction="row" gap={1.5}>
      <AlertTriangle size={28} />
      <Typography>{t("message.mcp_token_revoke_confirm")}</Typography>
    </Stack>
  );
};

export const McpTokensPanel = () => {
  const { t, i18n } = useTranslate();
  const { toast } = useToast();
  const dialogs = useDialogs();
  const queryClient = useTanstackQueryClient();
  const tokenQueryKey = getApiClientQueryKey("listMcpTokens");
  const [isCreateDialogOpen, setCreateDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [nameError, setNameError] = useState("");
  const [createdToken, setCreatedToken] =
    useState<McpTokenCreateResponse | null>(null);
  const hasShownListError = useRef(false);
  const locale = i18n.resolvedLanguage || i18n.language;
  const {
    data: tokens = [],
    isError,
    isLoading,
    isFetching,
  } = useApiClientQuery("listMcpTokens");
  const { mutate: createMcpToken, isPending: isCreating } =
    useApiClientMutation("createMcpToken", {
      onError: () => {
        toast.error(t("message.internal_server_error"));
      },
      onSuccess: (response) => {
        setCreateDialogOpen(false);
        setName("");
        setExpiresAt("");
        setNameError("");
        setCreatedToken(response);
        void queryClient.invalidateQueries({ queryKey: tokenQueryKey });
        toast.success(t("message.mcp_token_create_success"));
      },
    });
  const { mutate: revokeMcpToken, isPending: isRevoking } =
    useApiClientMutation("revokeMcpToken", {
      onError: () => {
        toast.error(t("message.internal_server_error"));
      },
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: tokenQueryKey });
        toast.success(t("message.mcp_token_revoke_success"));
      },
    });
  const rows = useMemo(
    () =>
      tokens.map((token) => ({
        token,
        status: getMcpTokenStatus(token),
      })),
    [tokens],
  );

  useEffect(() => {
    if (isError && !hasShownListError.current) {
      hasShownListError.current = true;
      toast.error(t("message.internal_server_error"));
    }

    if (!isError) {
      hasShownListError.current = false;
    }
  }, [isError, t, toast]);

  const formatDate = (date: McpToken["createdAt"] | null | undefined) =>
    formatOptionalDate(date, locale) ?? t("label.never");
  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!name.trim()) {
      setNameError(t("message.mcp_token_name_required"));

      return;
    }

    createMcpToken([toMcpTokenCreatePayload({ name, expiresAt })]);
  };
  const copyCreatedToken = async () => {
    if (!createdToken?.token) {
      return;
    }

    try {
      await writeToClipboard(createdToken.token);
      toast.success(t("message.mcp_token_copied"));
    } catch {
      toast.error(t("message.mcp_token_copy_failed"));
    }
  };
  const confirmRevoke = async (token: McpToken) => {
    const isConfirmed = await dialogs.confirm(McpTokenRevokeConfirmDialogBody, {
      title: t("title.revoke_mcp_token"),
      okText: t("button.revoke"),
      cancelText: t("button.cancel"),
      severity: "warning",
    });

    if (isConfirmed) {
      revokeMcpToken([token.id]);
    }
  };

  return (
    <Paper sx={{ padding: 4 }}>
      <Stack gap={3}>
        <Stack
          alignItems={{ xs: "stretch", sm: "center" }}
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          gap={2}
        >
          <Stack direction="row" alignItems="center" gap={1.5}>
            <KeyRound size={24} />
            <Typography variant="h6">{t("title.mcp_tokens")}</Typography>
          </Stack>
          <Button
            variant="contained"
            startIcon={<Plus size={18} />}
            onClick={() => setCreateDialogOpen(true)}
          >
            {t("button.create_mcp_token")}
          </Button>
        </Stack>

        {isLoading ? (
          <Stack alignItems="center" py={4}>
            <CircularProgress size={28} />
          </Stack>
        ) : rows.length === 0 ? (
          <Typography color="text.secondary">
            {t("message.mcp_token_empty")}
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small" aria-label={t("title.mcp_tokens")}>
              <TableHead>
                <TableRow>
                  <TableCell>{t("label.name")}</TableCell>
                  <TableCell>{t("label.token_prefix")}</TableCell>
                  <TableCell>{t("label.createdAt")}</TableCell>
                  <TableCell>{t("label.expires_at")}</TableCell>
                  <TableCell>{t("label.last_used_at")}</TableCell>
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
                    <TableCell>
                      <Chip
                        color={statusColorByStatus[status]}
                        label={t(`label.mcp_token_status_${status}`)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title={t("button.revoke")}>
                        <span>
                          <IconButton
                            aria-label={t("button.revoke")}
                            color="error"
                            disabled={
                              status !== "active" || isRevoking || isFetching
                            }
                            onClick={() => void confirmRevoke(token)}
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
        )}
      </Stack>

      <Dialog
        fullWidth
        maxWidth="sm"
        open={isCreateDialogOpen}
        onClose={() => {
          if (!isCreating) {
            setCreateDialogOpen(false);
          }
        }}
      >
        <form onSubmit={submitCreate}>
          <DialogTitle>{t("title.new_mcp_token")}</DialogTitle>
          <DialogContent>
            <Stack gap={2} pt={1}>
              <TextField
                autoFocus
                required
                label={t("label.name")}
                value={name}
                error={!!nameError}
                helperText={nameError || null}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameError("");
                }}
              />
              <TextField
                label={t("label.expires_at")}
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
                slotProps={{
                  inputLabel: {
                    shrink: true,
                  },
                }}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2 }}>
            <Button
              variant="outlined"
              onClick={() => setCreateDialogOpen(false)}
              disabled={isCreating}
            >
              {t("button.cancel")}
            </Button>
            <Button type="submit" variant="contained" disabled={isCreating}>
              {t("button.create_mcp_token")}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog
        fullWidth
        maxWidth="md"
        open={!!createdToken}
        onClose={() => setCreatedToken(null)}
      >
        <DialogTitle>{t("title.mcp_token_created")}</DialogTitle>
        <DialogContent>
          <Stack gap={2} pt={1}>
            <Alert severity="warning">{t("message.mcp_token_copy_once")}</Alert>
            <TextField
              label={t("label.mcp_token")}
              value={createdToken?.token ?? ""}
              fullWidth
              multiline
              minRows={2}
              slotProps={{
                input: {
                  readOnly: true,
                  sx: {
                    fontFamily: "monospace",
                    fontSize: "0.875rem",
                  },
                },
                inputLabel: {
                  shrink: true,
                },
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button variant="outlined" onClick={() => setCreatedToken(null)}>
            {t("button.close")}
          </Button>
          <Button
            variant="contained"
            startIcon={<Copy size={18} />}
            onClick={() => void copyCreatedToken()}
          >
            {t("button.copy_token")}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};
