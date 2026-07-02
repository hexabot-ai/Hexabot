/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { McpToken } from "@hexabot-ai/types";
import { CircularProgress, Stack, Typography } from "@mui/material";
import { AlertTriangle, Bot, Plus } from "lucide-react";
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

import {
  toDateTimeLocalValue,
  toMcpTokenCreatePayload,
} from "./api-tokens.utils";
import {
  CreatedTokenDialog,
  CreateTokenDialog,
  TokenEmptyState,
  TokenPanelHeader,
} from "./TokenDialogs";
import { TokenTable } from "./TokenTable";

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
  const { t } = useTranslate();
  const { toast } = useToast();
  const dialogs = useDialogs();
  const queryClient = useTanstackQueryClient();
  const tokenQueryKey = getApiClientQueryKey("listMcpTokens");
  const [isCreateDialogOpen, setCreateDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [nameError, setNameError] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const hasShownListError = useRef(false);
  const minExpiresAt = useMemo(() => toDateTimeLocalValue(new Date()), []);
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
        resetCreateForm();
        setCreateDialogOpen(false);
        setCreatedToken(response.token);
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

  useEffect(() => {
    if (isError && !hasShownListError.current) {
      hasShownListError.current = true;
      toast.error(t("message.internal_server_error"));
    }

    if (!isError) {
      hasShownListError.current = false;
    }
  }, [isError, t, toast]);

  function resetCreateForm() {
    setName("");
    setExpiresAt("");
    setNameError("");
  }
  const closeCreateDialog = () => {
    if (isCreating) {
      return;
    }

    setCreateDialogOpen(false);
    resetCreateForm();
  };
  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!name.trim()) {
      setNameError(t("message.mcp_token_name_required"));

      return;
    }

    createMcpToken([toMcpTokenCreatePayload({ name, expiresAt })]);
  };
  const confirmRevoke = async (token: Pick<McpToken, "id">) => {
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
    <>
      <Stack gap={3}>
        <TokenPanelHeader
          icon={<Bot size={24} />}
          title={t("title.mcp_tokens")}
          createLabel={t("button.create_mcp_token")}
          createIcon={<Plus size={18} />}
          onCreate={() => setCreateDialogOpen(true)}
        />

        {isLoading ? (
          <Stack alignItems="center" py={4}>
            <CircularProgress size={28} />
          </Stack>
        ) : tokens.length === 0 ? (
          <TokenEmptyState
            icon={<Bot size={32} />}
            message={t("message.mcp_token_empty")}
            createLabel={t("button.create_mcp_token")}
            createIcon={<Plus size={18} />}
            onCreate={() => setCreateDialogOpen(true)}
          />
        ) : (
          <TokenTable
            ariaLabel={t("title.mcp_tokens")}
            tokens={tokens}
            showScopes={false}
            isFetching={isFetching}
            isRevoking={isRevoking}
            onRevoke={(token) => void confirmRevoke(token)}
          />
        )}
      </Stack>

      <CreateTokenDialog
        open={isCreateDialogOpen}
        title={t("title.new_mcp_token")}
        submitLabel={t("button.create_mcp_token")}
        isCreating={isCreating}
        name={name}
        onNameChange={(value) => {
          setName(value);
          setNameError("");
        }}
        nameError={nameError}
        expiresAt={expiresAt}
        onExpiresAtChange={setExpiresAt}
        minExpiresAt={minExpiresAt}
        expiryHint={t("message.mcp_token_expiry_hint")}
        onClose={closeCreateDialog}
        onSubmit={submitCreate}
      />

      <CreatedTokenDialog
        title={t("title.mcp_token_created")}
        tokenLabel={t("label.mcp_token")}
        token={createdToken}
        copyOnceMessage={t("message.mcp_token_copy_once")}
        copiedMessage={t("message.mcp_token_copied")}
        copyFailedMessage={t("message.mcp_token_copy_failed")}
        onClose={() => setCreatedToken(null)}
      />
    </>
  );
};
