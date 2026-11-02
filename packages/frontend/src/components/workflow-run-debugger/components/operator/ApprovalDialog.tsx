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
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { CheckCircle, XCircle } from "lucide-react";
import { useState } from "react";

import { DialogTitle } from "@/app-components/dialogs";
import { useTranslate } from "@/hooks/useTranslate";
import type { DialogProps } from "@/types/common/dialogs.types";

import {
  describeOperatorWait,
  isWaitOpen,
  OPERATOR_TEXT_MAX_LENGTH,
} from "../../operator.utils";

import { OperatorDialogHandledAlert } from "./OperatorDialogHandledAlert";
import { OperatorErrorAlert } from "./OperatorErrorAlert";
import { OperatorWaitContext } from "./OperatorWaitContext";
import { useLiveRun, useOperatorSubmit } from "./useOperatorSubmit";

export type ApprovalDecision = "approve" | "reject";

export type ApprovalDialogPayload = {
  run: WorkflowRun | WorkflowRunFull;
  wait: WaitInfo;
  /** Decision the admin picked before opening the dialog, if any. */
  decision?: ApprovalDecision;
};

/**
 * Approve or reject an `await_approval` wait, with an optional comment
 * passed on to the workflow.
 */
export const ApprovalDialog = ({
  open,
  onClose,
  payload: { run, wait, decision },
}: DialogProps<ApprovalDialogPayload, WorkflowRunFull | undefined>) => {
  const { t } = useTranslate();
  const liveRun = useLiveRun(run);
  const [comment, setComment] = useState("");
  const { submit, isPending, pendingAction, error } =
    useOperatorSubmit(onClose);
  const isHandled = !isPending && !isWaitOpen(liveRun, wait.waitId);
  const isDisabled = isPending || isHandled;
  const close = isPending ? undefined : () => void onClose(undefined);
  const decide = (action: ApprovalDecision) =>
    submit({
      action,
      runId: run.id,
      body: { waitId: wait.waitId, comment: comment.trim() || undefined },
    });

  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
      onClose={close}
      disableEscapeKeyDown={isPending}
    >
      <DialogTitle onClose={close}>{t("title.approve_request")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} pt={0.5}>
          <OperatorDialogHandledAlert show={isHandled} />
          <OperatorWaitContext
            run={liveRun}
            wait={wait}
            view={describeOperatorWait(wait)}
          />
          <TextField
            label={t("label.comment")}
            placeholder={t("placeholder.operator_comment")}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            multiline
            minRows={2}
            maxRows={6}
            fullWidth
            disabled={isDisabled}
            slotProps={{
              htmlInput: { maxLength: OPERATOR_TEXT_MAX_LENGTH },
            }}
            helperText={`${comment.length}/${OPERATOR_TEXT_MAX_LENGTH}`}
          />
          <Typography variant="caption" color="text.secondary">
            {t("message.reject_may_fail_hint")}
          </Typography>
          <OperatorErrorAlert error={error} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="text" onClick={close} disabled={isPending}>
          {t("button.cancel")}
        </Button>
        <Box flex={1} />
        <Button
          variant="outlined"
          color="error"
          startIcon={<XCircle size={18} />}
          loading={pendingAction === "reject"}
          loadingPosition="start"
          disabled={isDisabled}
          autoFocus={decision === "reject"}
          onClick={() => void decide("reject")}
        >
          {t("button.reject")}
        </Button>
        <Button
          variant="contained"
          color="success"
          startIcon={<CheckCircle size={18} />}
          loading={pendingAction === "approve"}
          loadingPosition="start"
          disabled={isDisabled}
          autoFocus={decision !== "reject"}
          onClick={() => void decide("approve")}
        >
          {t("button.approve")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
