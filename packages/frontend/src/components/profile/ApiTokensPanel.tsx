/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Action, ApiToken } from "@hexabot-ai/types";
import { CircularProgress, Stack, Typography } from "@mui/material";
import { AlertTriangle, KeyRound, Plus } from "lucide-react";
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
  ApiTokenScopeGroup,
  getScopeKey,
  groupScopesByModel,
  scopeKeyOf,
  toApiTokenCreatePayload,
  toDateTimeLocalValue,
} from "./api-tokens.utils";
import { ScopeSelector } from "./ScopeSelector";
import {
  CreatedTokenDialog,
  CreateTokenDialog,
  TokenEmptyState,
  TokenPanelHeader,
} from "./TokenDialogs";
import { TokenTable } from "./TokenTable";

const ApiTokenRevokeConfirmDialogBody = () => {
  const { t } = useTranslate();

  return (
    <Stack direction="row" gap={1.5}>
      <AlertTriangle size={28} />
      <Typography>{t("message.api_token_revoke_confirm")}</Typography>
    </Stack>
  );
};

export const ApiTokensPanel = () => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const dialogs = useDialogs();
  const queryClient = useTanstackQueryClient();
  const tokenQueryKey = getApiClientQueryKey("listApiTokens");
  const [isCreateDialogOpen, setCreateDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [nameError, setNameError] = useState("");
  const [scopeError, setScopeError] = useState("");
  const [selectedScopeKeys, setSelectedScopeKeys] = useState<string[]>([]);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const hasShownListError = useRef(false);
  const minExpiresAt = useMemo(() => toDateTimeLocalValue(new Date()), []);
  const {
    data: tokens = [],
    isError,
    isLoading,
    isFetching,
  } = useApiClientQuery("listApiTokens");
  const { data: availableScopes = [], isLoading: areScopesLoading } =
    useApiClientQuery("listApiTokenScopes");
  const { mutate: createApiToken, isPending: isCreating } =
    useApiClientMutation("createApiToken", {
      onError: () => {
        toast.error(t("message.internal_server_error"));
      },
      onSuccess: (response) => {
        resetCreateForm();
        setCreateDialogOpen(false);
        setCreatedToken(response.token);
        void queryClient.invalidateQueries({ queryKey: tokenQueryKey });
        toast.success(t("message.api_token_create_success"));
      },
    });
  const { mutate: revokeApiToken, isPending: isRevoking } =
    useApiClientMutation("revokeApiToken", {
      onError: () => {
        toast.error(t("message.internal_server_error"));
      },
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: tokenQueryKey });
        toast.success(t("message.api_token_revoke_success"));
      },
    });
  const scopeGroups = useMemo(
    () => groupScopesByModel(availableScopes),
    [availableScopes],
  );
  const selectedKeySet = useMemo(
    () => new Set(selectedScopeKeys),
    [selectedScopeKeys],
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

  function resetCreateForm() {
    setName("");
    setExpiresAt("");
    setNameError("");
    setScopeError("");
    setSelectedScopeKeys([]);
  }
  const closeCreateDialog = () => {
    if (isCreating) {
      return;
    }

    setCreateDialogOpen(false);
    resetCreateForm();
  };
  const toggleScope = (model: string, action: Action) => {
    const key = scopeKeyOf(model, action);

    setScopeError("");
    setSelectedScopeKeys((current) =>
      current.includes(key)
        ? current.filter((candidate) => candidate !== key)
        : [...current, key],
    );
  };
  const toggleModel = (group: ApiTokenScopeGroup) => {
    const keys = group.actions.map((action) => scopeKeyOf(group.model, action));
    const allSelected = keys.every((key) => selectedKeySet.has(key));

    setScopeError("");
    setSelectedScopeKeys((current) => {
      const next = new Set(current);

      keys.forEach((key) => (allSelected ? next.delete(key) : next.add(key)));

      return [...next];
    });
  };
  const selectAllScopes = () => {
    setScopeError("");
    setSelectedScopeKeys(availableScopes.map(getScopeKey));
  };
  const clearScopes = () => {
    setScopeError("");
    setSelectedScopeKeys([]);
  };
  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!name.trim()) {
      setNameError(t("message.api_token_name_required"));

      return;
    }

    if (selectedScopeKeys.length === 0) {
      setScopeError(t("message.api_token_scope_required"));

      return;
    }

    createApiToken([
      toApiTokenCreatePayload({
        name,
        expiresAt,
        scopes: availableScopes.filter((scope) =>
          selectedKeySet.has(getScopeKey(scope)),
        ),
      }),
    ]);
  };
  const confirmRevoke = async (token: Pick<ApiToken, "id">) => {
    const isConfirmed = await dialogs.confirm(ApiTokenRevokeConfirmDialogBody, {
      title: t("title.revoke_api_token"),
      okText: t("button.revoke"),
      cancelText: t("button.cancel"),
      severity: "warning",
    });

    if (isConfirmed) {
      revokeApiToken([token.id]);
    }
  };

  return (
    <>
      <Stack gap={3}>
        <TokenPanelHeader
          icon={<KeyRound size={24} />}
          title={t("title.api_tokens")}
          createLabel={t("button.create_api_token")}
          createIcon={<Plus size={18} />}
          onCreate={() => setCreateDialogOpen(true)}
        />

        {isLoading ? (
          <Stack alignItems="center" py={4}>
            <CircularProgress size={28} />
          </Stack>
        ) : tokens.length === 0 ? (
          <TokenEmptyState
            icon={<KeyRound size={32} />}
            message={t("message.api_token_empty")}
            createLabel={t("button.create_api_token")}
            createIcon={<Plus size={18} />}
            onCreate={() => setCreateDialogOpen(true)}
          />
        ) : (
          <TokenTable
            ariaLabel={t("title.api_tokens")}
            tokens={tokens}
            showScopes
            isFetching={isFetching}
            isRevoking={isRevoking}
            onRevoke={(token) => void confirmRevoke(token)}
          />
        )}
      </Stack>

      <CreateTokenDialog
        open={isCreateDialogOpen}
        title={t("title.new_api_token")}
        submitLabel={t("button.create_api_token")}
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
        expiryHint={t("message.api_token_expiry_hint")}
        onClose={closeCreateDialog}
        onSubmit={submitCreate}
      >
        <Typography variant="subtitle2" mb={1}>
          {t("label.scopes")}
        </Typography>
        <ScopeSelector
          groups={scopeGroups}
          selectedKeys={selectedKeySet}
          selectedCount={selectedScopeKeys.length}
          totalCount={availableScopes.length}
          isLoading={areScopesLoading}
          error={scopeError}
          onToggleScope={toggleScope}
          onToggleModel={toggleModel}
          onSelectAll={selectAllScopes}
          onClear={clearScopes}
        />
      </CreateTokenDialog>

      <CreatedTokenDialog
        title={t("title.api_token_created")}
        tokenLabel={t("label.api_token")}
        token={createdToken}
        copyOnceMessage={t("message.api_token_copy_once")}
        copiedMessage={t("message.api_token_copied")}
        copyFailedMessage={t("message.api_token_copy_failed")}
        onClose={() => setCreatedToken(null)}
      />
    </>
  );
};
