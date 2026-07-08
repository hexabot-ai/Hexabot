/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowType } from "@hexabot-ai/types";
import type { Workflow } from "@hexabot-ai/types";
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import type { RJSFSchema } from "@rjsf/utils";
import {
  CalendarClock,
  Code,
  FileJson,
  Info,
  PlayCircle,
  Webhook,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  hasSchemaProperties,
  JsonSchemaForm,
} from "@/app-components/inputs/JsonSchemaForm";
import { WebhookSnippetDialog } from "@/components/workflow-webhook/WebhookSnippetDialog";
import { useConfig } from "@/hooks/useConfig";
import { useTranslate } from "@/hooks/useTranslate";
import validator from "@/utils/rjsf-zod-validator";

import { useRunWorkflow } from "../../../hooks/useRunWorkflow";

type TriggerSimulatorPanelProps = {
  workflow?: Workflow;
  formData: Record<string, unknown>;
  onFormDataChange: (data: Record<string, unknown>) => void;
};

export const TriggerSimulatorPanel = ({
  workflow,
  formData,
  onFormDataChange,
}: TriggerSimulatorPanelProps) => {
  const { t } = useTranslate();
  const { apiUrl } = useConfig();
  const { runWorkflow, isPending } = useRunWorkflow(workflow);
  const [isSnippetDialogOpen, setIsSnippetDialogOpen] = useState(false);
  const workflowType = workflow?.type;
  const isManualWorkflow = workflowType === WorkflowType.manual;
  const inputSchema = isManualWorkflow
    ? (workflow?.inputSchema as RJSFSchema | undefined)
    : undefined;
  const hasInputProperties = hasSchemaProperties(inputSchema);
  const isInputValid = useMemo(() => {
    if (!isManualWorkflow || !hasInputProperties || !inputSchema) {
      return true;
    }

    return validator.isValid(inputSchema, formData, inputSchema);
  }, [formData, hasInputProperties, inputSchema, isManualWorkflow]);
  const isWebhookEnabled = Boolean(
    isManualWorkflow && workflow?.id && workflow?.webhookTrigger?.enabled,
  );
  const webhookTriggerUrl = workflow?.id
    ? `${apiUrl}/webhook/${workflow.id}/trigger`
    : "";
  const isRunDisabled = !workflow?.id || !isInputValid || isPending;
  const runButton = (
    <Button
      fullWidth
      variant="contained"
      startIcon={<PlayCircle size={18} />}
      loading={isPending}
      loadingPosition="start"
      aria-label={t("button.run")}
      onClick={() => runWorkflow(formData)}
      disabled={isRunDisabled}
    >
      {t("button.run")}
    </Button>
  );

  return (
    <Paper
      variant="spaced"
      sx={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
      >
        <Typography variant="subtitle2" fontWeight={600}>
          {t("label.trigger_simulator")}
        </Typography>
        {isWebhookEnabled ? (
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Chip
              size="small"
              variant="outlined"
              color="success"
              icon={<Webhook size={14} />}
              label={t("label.webhook_enabled")}
            />
            <Tooltip title={t("button.view_code_snippet")}>
              <IconButton
                size="small"
                aria-label={t("button.view_code_snippet")}
                onClick={() => setIsSnippetDialogOpen(true)}
              >
                <Code size={16} />
              </IconButton>
            </Tooltip>
          </Stack>
        ) : null}
      </Stack>
      <Divider sx={{ mx: -2 }} />
      {isManualWorkflow ? (
        <>
          <Box flex={1} minHeight={0} overflow="auto">
            {hasInputProperties && inputSchema ? (
              <JsonSchemaForm
                schema={inputSchema}
                formData={formData}
                onFormDataChange={onFormDataChange}
                liveValidate
                idPrefix="workflow-trigger"
                enableJsonataTextWidget={false}
              />
            ) : (
              <Stack
                alignItems="center"
                justifyContent="center"
                spacing={1}
                sx={{
                  height: "100%",
                  minHeight: 120,
                  px: 2,
                  py: 3,
                  textAlign: "center",
                  color: "text.secondary",
                  border: "1px dashed",
                  borderColor: "divider",
                  borderRadius: 1,
                }}
              >
                <FileJson size={20} />
                <Stack spacing={0.25}>
                  <Typography variant="body2">
                    {t("message.workflow_input_schema_not_defined")}
                  </Typography>
                  <Typography variant="body2">
                    {t("message.workflow_empty_input_payload")}
                  </Typography>
                </Stack>
                <Typography variant="caption">
                  {t("message.workflow_input_schema_settings_hint")}
                </Typography>
              </Stack>
            )}
          </Box>
          <Divider sx={{ mx: -2 }} />
          {isInputValid ? (
            runButton
          ) : (
            <Tooltip title={t("message.workflow_input_invalid")}>
              <Box component="span" display="block">
                {runButton}
              </Box>
            </Tooltip>
          )}
        </>
      ) : (
        <Stack
          flex={1}
          minHeight={80}
          alignItems="center"
          justifyContent="center"
          spacing={1}
          sx={{ px: 2, textAlign: "center", color: "text.secondary" }}
        >
          {workflowType === WorkflowType.scheduled ? (
            <>
              <CalendarClock size={20} />
              <Typography variant="body2">
                {t("message.workflow_scheduled_run_now_hint")}
              </Typography>
            </>
          ) : (
            <>
              <Info size={20} />
              <Typography variant="body2">
                {t("message.workflow_trigger_simulator_availability")}
              </Typography>
            </>
          )}
        </Stack>
      )}
      {isWebhookEnabled ? (
        <WebhookSnippetDialog
          open={isSnippetDialogOpen}
          onClose={() => setIsSnippetDialogOpen(false)}
          url={webhookTriggerUrl}
          workflowId={workflow?.id}
          webhookTrigger={workflow?.webhookTrigger}
          body={formData}
        />
      ) : null}
    </Paper>
  );
};
