/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Alert } from "@mui/material";

import { useTranslate } from "@/hooks/useTranslate";

/**
 * Shown when the wait a dialog is about was resolved meanwhile (by another
 * admin, another tab, or a cancellation).
 */
export const OperatorDialogHandledAlert = ({ show }: { show: boolean }) => {
  const { t } = useTranslate();

  if (!show) {
    return null;
  }

  return <Alert severity="info">{t("message.operator_request_handled")}</Alert>;
};
