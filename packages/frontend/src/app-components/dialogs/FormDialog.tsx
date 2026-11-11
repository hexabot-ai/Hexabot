/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Dialog, DialogActions, DialogContent } from "@mui/material";

import { FormDialogProps } from "@/types/common/dialogs.types";

import { DialogFormButtons } from "../buttons/FormButtons";

import { DialogTitle } from "./DialogTitle";

export const FormDialog = ({
  title,
  children,
  onSubmit,
  cancelButtonProps,
  confirmButtonProps,
  ...rest
}: FormDialogProps) => {
  const onCancel = () => rest.onClose?.({}, "backdropClick");
  const dialogActions =
    rest.hasButtons === false ? null : (
      <DialogActions style={{ padding: "0.5rem" }}>
        <DialogFormButtons
          {...{ onSubmit, onCancel, confirmButtonProps, cancelButtonProps }}
        />
      </DialogActions>
    );

  return (
    <Dialog open={!!rest?.open} fullWidth {...rest}>
      <DialogTitle onClose={onCancel}>{title}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      {dialogActions}
    </Dialog>
  );
};
