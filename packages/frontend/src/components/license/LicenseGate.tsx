/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { ArrowRight, CircleCheck, Lock, Rocket } from "lucide-react";
import {
  cloneElement,
  useState,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { useAppRouter } from "@/hooks/useAppRouter";
import { useAuth } from "@/hooks/useAuth";
import { useTranslate } from "@/hooks/useTranslate";
import { TTranslationKeys } from "@/i18n/i18n.types";
import { ILicense, LicensePlan } from "@/types/user.types";

export type PaidPlan = Exclude<LicensePlan, "unknown">;

const PLAN_ORDER = ["unknown", "starter", "pro", "unlimited"] as const;
const PRICING_URL = "https://hexabot.ai/pricing/#pricing";
const DEFAULT_BENEFIT_KEYS: Record<PaidPlan, TTranslationKeys[]> = {
  starter: [
    "message.license_gate_benefits_starter_1",
    "message.license_gate_benefits_starter_2",
    "message.license_gate_benefits_starter_3",
  ],
  pro: [
    "message.license_gate_benefits_pro_1",
    "message.license_gate_benefits_pro_2",
    "message.license_gate_benefits_pro_3",
    "message.license_gate_benefits_pro_4",
  ],
  unlimited: [
    "message.license_gate_benefits_unlimited_1",
    "message.license_gate_benefits_unlimited_2",
    "message.license_gate_benefits_unlimited_3",
  ],
};
const getPlanRank = (plan: LicensePlan) => PLAN_ORDER.indexOf(plan);

export const hasLicensePlanAccess = (
  license: ILicense | undefined,
  requiredPlan: PaidPlan,
): boolean => {
  if (!license) {
    return false;
  }

  if (license.status !== "active") {
    return false;
  }

  return getPlanRank(license.plan) >= getPlanRank(requiredPlan);
};

export interface LockedFeatureLabelProps {
  requiredPlan: PaidPlan;
  tooltip?: string;
  sx?: any;
  size?: "small" | "medium";
}

export const LockedFeatureLabel = ({
  requiredPlan,
  tooltip,
  sx,
  size = "small",
}: LockedFeatureLabelProps) => {
  const { user } = useAuth();
  const { t } = useTranslate();
  const isAllowed = hasLicensePlanAccess(user?.license, requiredPlan);

  if (isAllowed) {
    return null;
  }

  const chip = (
    <Chip
      size={size}
      icon={<Lock color="#FFF" size={14} />}
      label={t("label.upgrade_required")}
      sx={{
        ...sx,
        ml: 1,
        pl: 0.5,
        pr: 1,
        py: 1.5,
        background:
          "linear-gradient(135deg, rgba(78,70,229,0.9) 0%, rgba(0,163,255,0.85) 50%, rgba(0,212,255,0.8) 100%)",
        color: "#FFF",
        "& .MuiChip-label": { px: 0.5, ml: 0.5 },
      }}
    />
  );

  return tooltip ? <Tooltip title={tooltip}>{chip}</Tooltip> : chip;
};

export interface LicenseGateProps {
  requiredPlan: PaidPlan;
  children: ReactElement;
  reasonText?: string;
  onUpgrade?: () => void;
  showInlineLabel?: boolean;
  disableChildWhenBlocked?: boolean;
}

export const shouldDisableBlockedChild = ({
  allowed,
  supportsDisabled,
  disableChildWhenBlocked,
}: {
  allowed: boolean;
  supportsDisabled: boolean;
  disableChildWhenBlocked: boolean;
}): boolean => !allowed && supportsDisabled && disableChildWhenBlocked;

const LicenseGate = ({
  requiredPlan,
  children,
  reasonText,
  onUpgrade,
  showInlineLabel = false,
  disableChildWhenBlocked = true,
}: LicenseGateProps) => {
  const router = useAppRouter();
  const { user } = useAuth();
  const { t } = useTranslate();
  const allowed = hasLicensePlanAccess(user?.license, requiredPlan);
  const [open, setOpen] = useState(false);
  const planDisplay = t(`label.plan_display_${requiredPlan}`);
  const reasonMessage =
    reasonText ?? t("message.license_gate_default_reason", { 0: planDisplay });
  const marketingBenefitKeys = DEFAULT_BENEFIT_KEYS[requiredPlan];
  const childProps = children.props as any;
  const supportsDisabled =
    typeof childProps.disabled !== "undefined" ||
    (children.type as any)?.muiName === "Button" ||
    (children.type as any)?.muiName === "IconButton";
  const disableBlockedChild = shouldDisableBlockedChild({
    allowed,
    supportsDisabled,
    disableChildWhenBlocked,
  });
  const childWithInlineLabel =
    showInlineLabel && !allowed ? (
      <Box
        component="span"
        sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}
      >
        {childProps.children}
        <LockedFeatureLabel requiredPlan={requiredPlan} size="small" />
      </Box>
    ) : (
      childProps.children
    );
  const handleBlockedClick = (e: ReactMouseEvent<HTMLElement>) => {
    if (!allowed) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    }
  };
  const gatedChild = cloneElement(children, {
    onClick: (e: ReactMouseEvent<HTMLElement>) => {
      if (!allowed) {
        return handleBlockedClick(e);
      }

      if (typeof childProps.onClick === "function") {
        childProps.onClick(e);
      }
    },
    "aria-disabled": disableBlockedChild ? true : childProps["aria-disabled"],
    tabIndex: disableBlockedChild ? -1 : childProps.tabIndex,
    ...(supportsDisabled
      ? {
          disabled: disableBlockedChild ? true : childProps.disabled,
        }
      : {}),
    children: childWithInlineLabel,
  } as any);

  return (
    <>
      <Tooltip
        title={!allowed ? reasonMessage : ""}
        disableHoverListener={allowed}
      >
        <Box
          component="span"
          onClick={handleBlockedClick}
          sx={{ display: "inline-flex", width: "fit-content" }}
        >
          {gatedChild}
        </Box>
      </Tooltip>

      <Dialog
        fullWidth
        open={open}
        onClose={() => setOpen(false)}
        aria-labelledby="upgrade-title"
        slotProps={{
          paper: {
            sx: {
              overflow: "hidden",
              borderRadius: 3,
              boxShadow: (theme) => theme.shadows[8],
            },
          },
        }}
      >
        <Box sx={{ position: "relative" }}>
          <Box
            sx={{
              px: 3,
              py: 3,
              color: "#fff",
              background:
                "linear-gradient(135deg, rgba(78,70,229,0.9) 0%, rgba(0,163,255,0.85) 50%, rgba(0,212,255,0.8) 100%)",
              position: "relative",
              overflow: "hidden",
              "&:before": {
                content: "''",
                position: "absolute",
                inset: -80,
                background:
                  "radial-gradient(circle at 20% 0%, rgba(255,255,255,0.25), transparent 40%)",
                pointerEvents: "none",
              },
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Lock size={18} />
              <Typography
                id="upgrade-title"
                variant="h5"
                sx={{
                  fontWeight: 800,
                  letterSpacing: 0.2,
                }}
              >
                {t("message.license_gate_title", { 0: planDisplay })}
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ opacity: 0.95, mt: 0.75 }}>
              {reasonMessage}
            </Typography>

            <Stack
              direction="row"
              alignItems="center"
              spacing={1.25}
              sx={{ mt: 1.5 }}
            >
              <PlanHint requiredPlan={requiredPlan} dark />
              <Divider
                flexItem
                orientation="vertical"
                sx={{ borderColor: "rgba(255,255,255,0.35)" }}
              />
              <Stack direction="row" spacing={1} alignItems="center">
                <Rocket size={16} />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t("message.license_gate_tagline")}
                </Typography>
              </Stack>
            </Stack>
          </Box>

          <DialogContent sx={{ pt: 2.5 }}>
            <Stack spacing={1.25} sx={{ mb: 1 }}>
              {marketingBenefitKeys.map((key, index) => (
                <Stack
                  key={index}
                  direction="row"
                  spacing={1.25}
                  alignItems="flex-start"
                >
                  <CircleCheck size={16} color="#2e7d32" />
                  <Typography variant="body1">{t(key)}</Typography>
                </Stack>
              ))}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {t("message.license_gate_footnote")}
            </Typography>
          </DialogContent>

          <DialogActions sx={{ px: 3, pb: 3, pt: 1 }}>
            <Button onClick={() => setOpen(false)}>
              {t("button.not_now")}
            </Button>
            <Button
              variant="outlined"
              onClick={() => {
                setOpen(false);
                router.push("/settings/groups/global_settings");
              }}
            >
              {t("button.enter_license_key")}
            </Button>
            <Button
              variant="contained"
              endIcon={<ArrowRight size={16} />}
              onClick={() => {
                setOpen(false);
                if (onUpgrade) {
                  onUpgrade();

                  return;
                }

                window.open(PRICING_URL, "_blank", "noopener,noreferrer");
              }}
            >
              {t("button.view_plans")}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </>
  );
};
const PlanHint = ({
  requiredPlan,
  dark,
}: {
  requiredPlan: PaidPlan;
  dark?: boolean;
}) => {
  const { t } = useTranslate();

  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 1,
        px: 1,
        py: 0.5,
        borderRadius: 1.5,
        border: "1px solid",
        borderColor: dark ? "rgba(255,255,255,0.4)" : "divider",
        color: dark ? "#fff" : "inherit",
        background: dark
          ? "linear-gradient(90deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))"
          : "linear-gradient(90deg, rgba(123,97,255,0.08), rgba(0,212,255,0.08))",
      }}
    >
      <Lock size={14} />
      <Typography variant="body2" sx={{ fontWeight: 700 }}>
        {t(`label.plan_badge_${requiredPlan}`)}
      </Typography>
    </Box>
  );
};

export default LicenseGate;
