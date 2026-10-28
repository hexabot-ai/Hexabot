/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WaitInfo } from "@hexabot-ai/agentic";
import type { WorkflowRun, WorkflowRunFull } from "@hexabot-ai/types";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormHelperText,
  Stack,
  Typography,
} from "@mui/material";
import { PlayCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { DialogTitle } from "@/app-components/dialogs";
import { JsonEditor } from "@/app-components/inputs/JsonEditor";
import {
  getSchemaDefaults,
  JsonSchemaForm,
} from "@/app-components/inputs/JsonSchemaForm";
import { useTranslate } from "@/hooks/useTranslate";
import type { DialogProps } from "@/types/common/dialogs.types";
import validator from "@/utils/rjsf-zod-validator";

import {
  describeOperatorWait,
  getResumeFormSchema,
  isWaitOpen,
  parseJsonObject,
} from "../../operator.utils";

import { OperatorDialogHandledAlert } from "./OperatorDialogHandledAlert";
import { OperatorErrorAlert } from "./OperatorErrorAlert";
import { OperatorWaitContext } from "./OperatorWaitContext";
import { useLiveRun, useOperatorSubmit } from "./useOperatorSubmit";

export type ResumeDialogPayload = {
  run: WorkflowRun | WorkflowRunFull;
  wait: WaitInfo;
};

const EMPTY_JSON_OBJECT = "{\n  \n}";

/**
 * Resume a `suspend_workflow` wait with data: a form generated from the
 * step's `payload_schema`, or a JSON object editor when it declares none
 * the form can render.
 */
export const ResumeDialog = ({
  open,
  onClose,
  payload: { run, wait },
}: DialogProps<ResumeDialogPayload, WorkflowRunFull | undefined>) => {
  const { t } = useTranslate();
  const liveRun = useLiveRun(run);
  const view = useMemo(() => describeOperatorWait(wait), [wait]);
  const formSchema = useMemo(
    () => getResumeFormSchema(view?.payloadSchema),
    [view],
  );
  const [formData, setFormData] = useState<Record<string, unknown>>(
    () => (formSchema && getSchemaDefaults(formSchema)) || {},
  );
  const [jsonText, setJsonText] = useState(EMPTY_JSON_OBJECT);
  const parsedJson = useMemo(() => parseJsonObject(jsonText), [jsonText]);
  const isPayloadValid = formSchema
    ? validator.isValid(formSchema, formData, formSchema)
    : parsedJson.ok;
  const { submit, isPending, error } = useOperatorSubmit(onClose);
  const isHandled = !isPending && !isWaitOpen(liveRun, wait.waitId);
  const isDisabled = isPending || isHandled;
  const close = isPending ? undefined : () => void onClose(undefined);
  const resume = () => {
    const data = formSchema
      ? formData
      : parsedJson.ok
        ? parsedJson.value
        : undefined;

    if (!data) {
      return;
    }

    void submit({
      action: "resume",
      runId: run.id,
      body: { waitId: wait.waitId, data },
    });
  };

  return (
    <Dialog
      open={open}
      maxWidth="md"
      fullWidth
      onClose={close}
      disableEscapeKeyDown={isPending}
    >
      <DialogTitle onClose={close}>{t("title.resume_run")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} pt={0.5}>
          <OperatorDialogHandledAlert show={isHandled} />
          <OperatorWaitContext run={liveRun} wait={wait} view={view} />
          <Stack spacing={1}>
            <Typography variant="subtitle2">
              {t("label.resume_data")}
            </Typography>
            {formSchema ? (
              <Box
                sx={{
                  pointerEvents: isDisabled ? "none" : undefined,
                  opacity: isDisabled ? 0.6 : 1,
                }}
              >
                <JsonSchemaForm
                  schema={formSchema}
                  formData={formData}
                  onFormDataChange={setFormData}
                  liveValidate
                  idPrefix="workflow-resume"
                  enableJsonataTextWidget={false}
                />
              </Box>
            ) : (
              <>
                <Typography variant="caption" color="text.secondary">
                  {t("message.resume_data_any_object")}
                </Typography>
                <Box
                  height={220}
                  overflow="hidden"
                  border={1}
                  borderColor={parsedJson.ok ? "divider" : "error.main"}
                  borderRadius={1}
                >
                  <JsonEditor
                    value={jsonText}
                    onChange={setJsonText}
                    readOnly={isDisabled}
                  />
                </Box>
                {!parsedJson.ok ? (
                  <FormHelperText error>
                    {t(
                      parsedJson.reason === "invalid"
                        ? "message.json_invalid"
                        : "message.json_must_be_object",
                    )}
                  </FormHelperText>
                ) : null}
              </>
            )}
          </Stack>
          <OperatorErrorAlert error={error} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="text" onClick={close} disabled={isPending}>
          {t("button.cancel")}
        </Button>
        <Button
          variant="contained"
          startIcon={<PlayCircle size={18} />}
          loading={isPending}
          loadingPosition="start"
          disabled={isDisabled || !isPayloadValid}
          onClick={resume}
        >
          {t("button.resume")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
