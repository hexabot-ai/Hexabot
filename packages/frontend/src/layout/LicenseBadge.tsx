/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Badge, Chip, SxProps, Tooltip } from "@mui/material";

import { useTranslate } from "@/hooks/useTranslate";
import { ILicense } from "@/types/user.types";

type LicenseBadgeProps = {
  license: ILicense;
  className?: string;
  sx?: SxProps;
};

const gradients = {
  unknown: "linear-gradient(135deg, #9ea3aa 0%, #c3c7cc 100%)",
  starter: "linear-gradient(135deg, #22d3ee 0%, #34d399 100%)",
  pro: "linear-gradient(135deg, #7c3aed 0%, #ec4899 100%)",
  unlimited: "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)",
} as const;
const LicenseBadge = ({ license, className, sx }: LicenseBadgeProps) => {
  const { t } = useTranslate();
  const isActive = license.status === "active";
  const badgeLabel = t(`label.license_badge_${license.plan}`);
  const activations = `${license.activationUsage ?? "-"}/${license.activationLimit ?? "-"}`;
  const title =
    license.plan === "unknown"
      ? t("message.purchase_license")
      : [
          t("message.license_badge_status", {
            0: license.status.toUpperCase(),
          }),
          t("message.license_badge_activations", { 0: activations }),
          license.lastError,
        ]
          .filter(Boolean)
          .join(" • ");

  return (
    <Tooltip enterDelay={300} title={title}>
      <a
        href="https://hexabot.ai/pricing/#pricing"
        target="_blank"
        rel="noopener noreferrer"
        style={{ textDecoration: "none" }}
      >
        <Badge
          overlap="rectangular"
          variant="dot"
          color={isActive ? "success" : "error"}
          anchorOrigin={{ vertical: "top", horizontal: "right" }}
          sx={{
            "& .MuiBadge-dot": {
              width: 8,
              height: 8,
              minWidth: 0,
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.9)",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.05)",
              top: 2,
              right: 2,
            },
            ...sx,
          }}
          className={className}
        >
          <Chip
            size="small"
            label={badgeLabel}
            aria-label={`License: ${badgeLabel} (${license.status})`}
            sx={{
              backgroundImage: gradients[license.plan],
              color: "#fff",
              border: 0,
              px: 1,
            }}
          />
        </Badge>
      </a>
    </Tooltip>
  );
};

export default LicenseBadge;
