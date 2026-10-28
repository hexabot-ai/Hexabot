/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Chip } from "@mui/material";
import { Hourglass, PencilLine, ShieldCheck } from "lucide-react";

import { useTranslate } from "@/hooks/useTranslate";

import { isApprovalWait, isResumeWait } from "../../operator.utils";

type WaitReasonChipProps = {
  reason?: string;
};

const getReasonIcon = (reason: string) => {
  if (isApprovalWait({ reason })) return ShieldCheck;
  if (isResumeWait({ reason })) return PencilLine;

  return Hourglass;
};

/**
 * Translated reason of an open wait (e.g. "Approval", "Input needed").
 * Unknown reasons, from custom actions, are shown as is.
 */
export const WaitReasonChip = ({ reason }: WaitReasonChipProps) => {
  const { t } = useTranslate();

  if (!reason) {
    return null;
  }

  const Icon = getReasonIcon(reason);

  return (
    <Chip
      size="small"
      variant="outlined"
      color="warning"
      icon={<Icon size={14} />}
      label={t(`label.wait_reasons.${reason}`) || reason}
    />
  );
};
