/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { Copy } from "lucide-react";
import { FormEvent, ReactNode } from "react";

import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { writeToClipboard } from "@/utils/clipboard";

type CreateTokenDialogProps = {
  open: boolean;
  title: string;
  submitLabel: string;
  isCreating: boolean;
  name: string;
  onNameChange: (value: string) => void;
  nameError: string;
  expiresAt: string;
  onExpiresAtChange: (value: string) => void;
  minExpiresAt: string;
  expiryHint: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Extra fields rendered below the shared name/expiry inputs (e.g. scopes). */
  children?: ReactNode;
};

export const CreateTokenDialog = ({
  open,
  title,
  submitLabel,
  isCreating,
  name,
  onNameChange,
  nameError,
  expiresAt,
  onExpiresAtChange,
  minExpiresAt,
  expiryHint,
  onClose,
  onSubmit,
  children,
}: CreateTokenDialogProps) => {
  const { t } = useTranslate();

  return (
    <Dialog fullWidth maxWidth="sm" open={open} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          <Stack gap={2} pt={1}>
            <TextField
              autoFocus
              required
              label={t("label.name")}
              value={name}
              error={!!nameError}
              helperText={nameError || null}
              onChange={(event) => onNameChange(event.target.value)}
            />
            <TextField
              label={t("label.expires_at")}
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => onExpiresAtChange(event.target.value)}
              helperText={expiryHint}
              slotProps={{
                inputLabel: {
                  shrink: true,
                },
                htmlInput: {
                  min: minExpiresAt,
                },
              }}
            />
            {children ? <Box>{children}</Box> : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button variant="outlined" onClick={onClose} disabled={isCreating}>
            {t("button.cancel")}
          </Button>
          <Button type="submit" variant="contained" disabled={isCreating}>
            {submitLabel}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

type CreatedTokenDialogProps = {
  title: string;
  tokenLabel: string;
  token: string | null;
  copyOnceMessage: string;
  copiedMessage: string;
  copyFailedMessage: string;
  onClose: () => void;
};

export const CreatedTokenDialog = ({
  title,
  tokenLabel,
  token,
  copyOnceMessage,
  copiedMessage,
  copyFailedMessage,
  onClose,
}: CreatedTokenDialogProps) => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const copyToken = async () => {
    if (!token) {
      return;
    }

    try {
      await writeToClipboard(token);
      toast.success(copiedMessage);
    } catch {
      toast.error(copyFailedMessage);
    }
  };

  return (
    <Dialog fullWidth maxWidth="md" open={!!token} onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack gap={2} pt={1}>
          <Alert severity="warning">{copyOnceMessage}</Alert>
          <TextField
            label={tokenLabel}
            value={token ?? ""}
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
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title={t("button.copy_token")}>
                      <IconButton
                        aria-label={t("button.copy_token")}
                        onClick={() => void copyToken()}
                        size="small"
                      >
                        <Copy size={18} />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              },
              inputLabel: {
                shrink: true,
              },
            }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button variant="outlined" onClick={onClose}>
          {t("button.close")}
        </Button>
        <Button
          variant="contained"
          startIcon={<Copy size={18} />}
          onClick={() => void copyToken()}
        >
          {t("button.copy_token")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

type TokenPanelHeaderProps = {
  icon: ReactNode;
  title: string;
  createLabel: string;
  onCreate: () => void;
  createIcon: ReactNode;
};

export const TokenPanelHeader = ({
  icon,
  title,
  createLabel,
  onCreate,
  createIcon,
}: TokenPanelHeaderProps) => (
  <Stack
    alignItems={{ xs: "stretch", sm: "center" }}
    direction={{ xs: "column", sm: "row" }}
    justifyContent="space-between"
    gap={2}
  >
    <Stack direction="row" alignItems="center" gap={1.5}>
      {icon}
      <Typography variant="h6">{title}</Typography>
    </Stack>
    <Button variant="contained" startIcon={createIcon} onClick={onCreate}>
      {createLabel}
    </Button>
  </Stack>
);

type TokenEmptyStateProps = {
  icon: ReactNode;
  message: string;
  createLabel: string;
  onCreate: () => void;
  createIcon: ReactNode;
};

export const TokenEmptyState = ({
  icon,
  message,
  createLabel,
  onCreate,
  createIcon,
}: TokenEmptyStateProps) => (
  <Stack alignItems="center" gap={1.5} py={5}>
    <Box sx={{ color: "text.disabled", display: "flex" }}>{icon}</Box>
    <Typography color="text.secondary">{message}</Typography>
    <Button variant="outlined" startIcon={createIcon} onClick={onCreate}>
      {createLabel}
    </Button>
  </Stack>
);
