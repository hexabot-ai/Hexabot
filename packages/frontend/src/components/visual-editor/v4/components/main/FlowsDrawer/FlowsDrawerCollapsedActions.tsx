/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Box, IconButton, Tooltip } from "@mui/material";
import { Plus, Search, Upload } from "lucide-react";
import type { ReactElement } from "react";

import { YamlToggleButton } from "./YamlToggleButton";

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
  yamlIssueCount?: number;
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
  yamlIssueCount = 0,
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
    <YamlToggleButton
      label={yamlLabel}
      onToggle={onToggleYaml}
      isOpen={isYamlOpen}
      issueCount={yamlIssueCount}
    />
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
