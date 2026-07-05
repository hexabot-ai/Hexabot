/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WebhookAuthType } from "@hexabot-ai/types";
import type { WebhookTriggerConfig } from "@hexabot-ai/types";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogContent,
  IconButton,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import { Copy, KeyRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DialogTitle } from "@/app-components/dialogs";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { writeToClipboard } from "@/utils/clipboard";

import { useGenerateWebhookToken } from "./hooks/useGenerateWebhookToken";
import {
  generateWebhookSnippet,
  toSnippetAuth,
  WEBHOOK_SNIPPET_TARGETS,
} from "./webhook-snippets.utils";
import type { WebhookSnippetTarget } from "./webhook-snippets.utils";

type WebhookSnippetDialogProps = {
  open: boolean;
  onClose: () => void;
  url: string;
  workflowId?: string;
  webhookTrigger?: WebhookTriggerConfig | null;
  body: Record<string, unknown>;
};

export const WebhookSnippetDialog = ({
  open,
  onClose,
  url,
  workflowId,
  webhookTrigger,
  body,
}: WebhookSnippetDialogProps) => {
  const { t } = useTranslate();
  const { toast } = useToast();
  const [target, setTarget] = useState<WebhookSnippetTarget>("curl");
  const { generateToken, tokenResult, isPending, reset } =
    useGenerateWebhookToken(workflowId);
  const isJwtAuth = webhookTrigger?.authType === WebhookAuthType.jwt;
  const snippet = useMemo(
    () =>
      generateWebhookSnippet(target, {
        url,
        auth: toSnippetAuth(webhookTrigger, tokenResult?.token),
        body,
      }),
    [target, url, webhookTrigger, body, tokenResult],
  );

  // Drop any generated token when the dialog closes so a reopened dialog
  // never shows a token signed with a since-changed configuration.
  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  const handleCopy = async () => {
    await writeToClipboard(snippet);
    toast.success(t("message.webhook_snippet_copied"));
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle onClose={onClose}>
        {t("label.webhook_code_snippet")}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" mb={1}>
          {t("message.webhook_snippet_hint")}
        </Typography>
        <Tabs
          value={target}
          onChange={(_event, value: WebhookSnippetTarget) => setTarget(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 1 }}
        >
          {WEBHOOK_SNIPPET_TARGETS.map(({ id, label }) => (
            <Tab key={id} value={id} label={label} />
          ))}
        </Tabs>
        <Box position="relative">
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 2,
              pr: 7,
              borderRadius: 1,
              bgcolor: "action.hover",
              fontFamily: "monospace",
              fontSize: "0.8125rem",
              lineHeight: 1.6,
              overflow: "auto",
              maxHeight: "50vh",
              whiteSpace: "pre",
            }}
          >
            {snippet}
          </Box>
          <Tooltip title={t("button.copy")}>
            <IconButton
              size="small"
              onClick={handleCopy}
              sx={{ position: "absolute", top: 8, right: 8 }}
            >
              <Copy size={16} />
            </IconButton>
          </Tooltip>
        </Box>
        {isJwtAuth ? (
          <Alert
            severity="info"
            sx={{
              mt: 1,
              // Keep the long hint from squeezing the action button into
              // wrapped, broken words.
              "& .MuiAlert-action": {
                alignItems: "center",
                pt: 0,
                flexShrink: 0,
              },
            }}
            action={
              workflowId ? (
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={<KeyRound size={16} />}
                  loading={isPending}
                  onClick={() => generateToken()}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  {t("button.generate_token")}
                </Button>
              ) : undefined
            }
          >
            {tokenResult
              ? t("message.webhook_token_generated")
              : t("message.webhook_jwt_token_hint")}
          </Alert>
        ) : null}
        {webhookTrigger?.authType === WebhookAuthType.basic ||
        webhookTrigger?.authType === WebhookAuthType.header ? (
          <Alert severity="info" sx={{ mt: 1 }}>
            {t("message.webhook_secret_placeholder_hint")}
          </Alert>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
