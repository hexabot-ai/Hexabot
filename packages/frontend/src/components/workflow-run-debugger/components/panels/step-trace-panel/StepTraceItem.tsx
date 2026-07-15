/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { StepExecutionRecord } from "@hexabot-ai/agentic";
import { resolveWorkflowStepTheme } from "@hexabot-ai/graph";
import { Box, Chip, Paper, Typography } from "@mui/material";
import { alpha, useColorScheme, useTheme } from "@mui/material/styles";
import type { KeyboardEvent } from "react";

import { useWorkflowActionsCatalog } from "@/contexts/workflow-actions.context";
import { formatDurationMs } from "@/utils/date";

import { ActionStatusIndicator } from "./ActionStatusIndicator";
import { getStepDuration } from "./utils";

type StepTraceItemProps = {
  step: StepExecutionRecord;
  isSelected?: boolean;
  onSelect?: (stepId: string) => void;
};

export const StepTraceItem = ({
  step,
  isSelected = false,
  onSelect,
}: StepTraceItemProps) => {
  const theme = useTheme();
  const { mode, systemMode } = useColorScheme();
  const resolvedMode =
    mode === "dark" || (mode === "system" && systemMode === "dark")
      ? "dark"
      : "light";
  const resolvedMuiTheme = theme.vars || theme;
  const { actionsByName } = useWorkflowActionsCatalog();
  const actionDefinition = step.action
    ? actionsByName.get(step.action)
    : undefined;
  const resolvedTheme = resolveWorkflowStepTheme({
    action: actionDefinition,
    status: step.status,
    mode: resolvedMode,
  });
  const groupLabel = actionDefinition?.group?.trim();
  const accentColor =
    resolvedTheme.iconColor ??
    resolvedTheme.borderColor ??
    theme.palette.primary.main;
  const itemBorderColor = resolvedTheme.borderColor
    ? alpha(resolvedTheme.borderColor, 0.25)
    : "divider";
  const itemBackgroundColor =
    resolvedTheme.bgColor ?? resolvedMuiTheme.palette.background.paper;
  const IconComponent = resolvedTheme.Icon;
  const isInteractive = Boolean(onSelect);
  const selectedBackgroundColor = alpha(accentColor, 0.14);
  const selectedOutlineColor = alpha(accentColor, 0.45);
  const hoverBackgroundColor = alpha(accentColor, 0.05);
  const baseShadow = theme.shadows[1];
  const hoverShadow = theme.shadows[3];
  const selectedShadow = `0 0 0 1px ${selectedOutlineColor}, ${theme.shadows[4]}`;
  const selectedHoverShadow = `0 0 0 1px ${selectedOutlineColor}, ${theme.shadows[6]}`;
  const handleSelect = () => onSelect?.(step.id);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onSelect) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleSelect();
    }
  };
  const interactiveProps = isInteractive
    ? {
        role: "button" as const,
        tabIndex: 0,
        "aria-pressed": isSelected,
        onClick: handleSelect,
        onKeyDown: handleKeyDown,
      }
    : {};
  const interactiveSx = isInteractive
    ? {
        cursor: "pointer",
        "&:hover": {
          borderColor: accentColor,
          backgroundColor: isSelected
            ? selectedBackgroundColor
            : hoverBackgroundColor,
          boxShadow: isSelected ? selectedHoverShadow : hoverShadow,
        },
        "&:focus-visible": {
          outline: `2px solid ${selectedOutlineColor}`,
          outlineOffset: 2,
        },
      }
    : { cursor: "default" };

  return (
    <Paper
      variant="outlined"
      {...interactiveProps}
      sx={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 1.5,
        alignItems: "center",
        p: 1.5,
        borderRadius: 1.5,
        position: "relative",
        borderColor: isSelected ? accentColor : itemBorderColor,
        backgroundColor: isSelected
          ? selectedBackgroundColor
          : itemBackgroundColor,
        boxShadow: isSelected ? selectedShadow : baseShadow,
        transition:
          "border-color 150ms ease, box-shadow 150ms ease, background-color 150ms ease",
        ...interactiveSx,
      }}
    >
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: alpha(accentColor, isSelected ? 0.2 : 0.12),
          boxShadow: isSelected
            ? `inset 0 0 0 1px ${alpha(accentColor, 0.45)}`
            : "none",
          color: accentColor,
          flexShrink: 0,
        }}
      >
        <IconComponent size={18} />
      </Box>
      <Box minWidth={0}>
        <Box display="flex" alignItems="center" gap={1}>
          <Typography
            variant="subtitle2"
            fontWeight={600}
            noWrap
            sx={{ color: isSelected ? accentColor : "text.primary" }}
          >
            {step.name}
          </Typography>
        </Box>
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
          {groupLabel ? (
            <Chip
              label={groupLabel}
              size="small"
              sx={{
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            />
          ) : null}
          {step.reason && (
            <Typography variant="caption" color="text.secondary" noWrap>
              {step.reason}
            </Typography>
          )}
        </Box>
      </Box>
      <Box display="flex" alignItems="center" gap={1.5} justifySelf="end">
        <ActionStatusIndicator status={step.status} />
        <Typography variant="caption" color="text.secondary">
          {formatDurationMs(getStepDuration(step))}
        </Typography>
      </Box>
    </Paper>
  );
};
