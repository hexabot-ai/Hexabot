/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus } from "@hexabot-ai/agentic";
import type { WorkflowRun, WorkflowRunFull } from "@hexabot-ai/types";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Stack,
  TextField,
} from "@mui/material";
import { Ban } from "lucide-react";
import { useState } from "react";

import { DialogTitle } from "@/app-components/dialogs";
import { useTranslate } from "@/hooks/useTranslate";
import type { DialogProps } from "@/types/common/dialogs.types";

import { OPERATOR_TEXT_MAX_LENGTH } from "../../operator.utils";

import { OperatorDialogHandledAlert } from "./OperatorDialogHandledAlert";
import { useLiveRun, useOperatorSubmit } from "./useOperatorSubmit";

export type CancelRunDialogPayload = {
  run: WorkflowRun | WorkflowRunFull;
};

/**
 * Cancel a suspended run, whatever it waits on, with an optional reason
 * stored on the failed run.
 */
export const CancelRunDialog = ({
  open,
  onClose,
  payload: { run },
}: DialogProps<CancelRunDialogPayload, WorkflowRunFull | undefined>) => {
  const { t } = useTranslate();
  const liveRun = useLiveRun(run);
  const [reason, setReason] = useState("");
  const { submit, isPending } = useOperatorSubmit(onClose);
  const isHandled =
    !isPending && liveRun.status !== EWorkflowRunStatus.SUSPENDED;
  const isDisabled = isPending || isHandled;
  const close = isPending ? undefined : () => void onClose(undefined);

  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
      onClose={close}
      disableEscapeKeyDown={isPending}
    >
      <DialogTitle onClose={close}>{t("title.cancel_run")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} pt={0.5}>
          <OperatorDialogHandledAlert show={isHandled} />
          <Alert severity="warning">
            {t("message.cancel_run_explanation")}
          </Alert>
          <TextField
            label={t("label.cancel_reason")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            multiline
            minRows={2}
            maxRows={6}
            fullWidth
            disabled={isDisabled}
            slotProps={{
              htmlInput: { maxLength: OPERATOR_TEXT_MAX_LENGTH },
            }}
            helperText={`${reason.length}/${OPERATOR_TEXT_MAX_LENGTH}`}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="text" onClick={close} disabled={isPending}>
          {t("button.keep_waiting")}
        </Button>
        <Button
          variant="contained"
          color="error"
          startIcon={<Ban size={18} />}
          loading={isPending}
          loadingPosition="start"
          disabled={isDisabled}
          onClick={() =>
            void submit({
              action: "cancel",
              runId: run.id,
              body: { reason: reason.trim() || undefined },
            })
          }
        >
          {t("button.cancel_run")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
