/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Workflow } from "@hexabot-ai/types";
import {
  alpha,
  Box,
  Card,
  CardContent,
  IconButton,
  Typography,
  useTheme,
} from "@mui/material";
import { Eye } from "lucide-react";

import { WORKFLOW_TYPES } from "@/constants/workflow.constants";
import { useAppRouter } from "@/hooks/useAppRouter";
import { useTranslate } from "@/hooks/useTranslate";
import { RouterType } from "@/services/types";

import { IconContainer } from "./IconContainer";

export const LatestWorkflowsCard = ({ workflow }: { workflow: Workflow }) => {
  const theme = useTheme();
  const router = useAppRouter();
  const { t } = useTranslate();
  const workflowTypeInfo = WORKFLOW_TYPES[workflow.type];
  const Icon = workflowTypeInfo.icon;
  const openWorkflow = () => {
    router.push({
      pathname: `/${RouterType.WORKFLOW_EDITOR}/${workflow.id}`,
    });
  };

  return (
    <Card
      onClick={openWorkflow}
      elevation={0}
      sx={{
        borderRadius: 3,
        bgcolor: alpha(theme.palette.background.default, 0.5),
        border: `1px solid ${alpha(theme.palette.primary.main, 0.25)}`,
        transition: "all 0.2s ease-in-out",
        cursor: "pointer",
        overflow: "visible",
        "&:hover": {
          bgcolor: "background.paper",
          border: `1px solid ${alpha(theme.palette.primary.main, 1)}`,
          boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
          transform: "translateY(-2px)",
          "& .view-button": { opacity: 1, transform: "scale(1)" },
        },
      }}
    >
      <CardContent
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          position: "relative",
          margin: "auto",
        }}
      >
        <IconContainer
          icon={Icon}
          color={theme.palette.primary.main}
          borderRadius="16px"
        />

        {/* Content */}
        <Box minWidth={0}>
          <Box display="flex" alignItems="center" gap={1} mb={0.5}>
            <Typography variant="subtitle2" fontWeight="bold" noWrap>
              {workflow.name}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" display="block">
            {t(workflowTypeInfo.labelKey)}
          </Typography>
        </Box>

        {/* Hover Action */}
        <IconButton
          className="view-button"
          color="primary"
          aria-label={t("label.view")}
          onClick={(event) => {
            event.stopPropagation();
            openWorkflow();
          }}
          sx={{
            position: "absolute",
            right: 16,
            opacity: 0,
            transform: "scale(0.8)",
            transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
            bgcolor: alpha(theme.palette.primary.main, 0.1),
            "&:hover": { bgcolor: theme.palette.primary.main, color: "white" },
          }}
        >
          <Eye size={18} />
        </IconButton>
      </CardContent>
    </Card>
  );
};
