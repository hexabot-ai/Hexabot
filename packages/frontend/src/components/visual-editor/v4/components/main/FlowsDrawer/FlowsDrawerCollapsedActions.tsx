/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Badge, Box, IconButton, Tooltip } from "@mui/material";
import { Code, Plus, Search, Upload } from "lucide-react";
import type { ReactElement } from "react";

type FlowsDrawerCollapsedActionsProps = {
  searchLabel: string;
  importWorkflowLabel: string;
  importWorkflowDisabled?: boolean;
  newWorkflowLabel: string;
  newWorkflowDisabled?: boolean;
  newWorkflowDisabledReason?: string;
  newWorkflowAction?: ReactElement;
  yamlLabel: string;
  onOpen: () => void;
  onImport: () => void;
  onNew?: () => void;
  onToggleYaml: () => void;
  isYamlOpen: boolean;
  yamlWarningCount: number;
  yamlErrorCount: number;
};

export const FlowsDrawerCollapsedActions = ({
  searchLabel,
  importWorkflowLabel,
  importWorkflowDisabled = false,
  newWorkflowLabel,
  newWorkflowDisabled = false,
  newWorkflowDisabledReason,
  newWorkflowAction,
  yamlLabel,
  onOpen,
  onImport,
  onNew,
  onToggleYaml,
  isYamlOpen,
  yamlWarningCount,
  yamlErrorCount,
}: FlowsDrawerCollapsedActionsProps) => (
  <Box
    display="flex"
    flexDirection="column"
    alignItems="center"
    gap={1}
    px={1}
    pb={1}
  >
    <Tooltip title={searchLabel}>
      <IconButton size="small" onClick={onOpen}>
        <Search size={16} />
      </IconButton>
    </Tooltip>
    <Tooltip title={yamlLabel}>
      <Badge
        badgeContent={yamlWarningCount}
        color="warning"
        invisible={yamlWarningCount === 0}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
      >
        <Badge
          badgeContent={yamlErrorCount}
          color="error"
          invisible={yamlErrorCount === 0}
        >
          <IconButton
            size="small"
            onClick={onToggleYaml}
            color={isYamlOpen ? "primary" : "default"}
            aria-pressed={isYamlOpen}
          >
            <Code size={16} />
          </IconButton>
        </Badge>
      </Badge>
    </Tooltip>
    <Tooltip title={importWorkflowLabel}>
      <span>
        <IconButton
          size="small"
          onClick={onImport}
          disabled={importWorkflowDisabled}
        >
          <Upload size={16} />
        </IconButton>
      </span>
    </Tooltip>
    {newWorkflowAction ?? (
      <Tooltip
        title={
          newWorkflowDisabled
            ? (newWorkflowDisabledReason ?? "")
            : newWorkflowLabel
        }
        disableHoverListener={!newWorkflowDisabled && !newWorkflowLabel}
      >
        <span>
          <IconButton
            size="small"
            onClick={onNew}
            disabled={!onNew || newWorkflowDisabled}
          >
            <Plus size={16} />
          </IconButton>
        </span>
      </Tooltip>
    )}
  </Box>
);
