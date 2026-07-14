/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Badge, Box, IconButton, Tooltip, Typography } from "@mui/material";
import { ChevronLeft, ChevronRight, Code, History } from "lucide-react";

import { FlowDrawerHeader } from "./styles";

type FlowsDrawerHeaderProps = {
  open: boolean;
  title: string;
  onToggle: () => void;
  yamlLabel: string;
  onToggleYaml: () => void;
  isYamlOpen: boolean;
  yamlIssueCount?: number;
  versionsLabel: string;
  onToggleVersions: () => void;
  isVersionsOpen: boolean;
};

export const FlowsDrawerHeader = ({
  open,
  title,
  onToggle,
  yamlLabel,
  onToggleYaml,
  isYamlOpen,
  yamlIssueCount = 0,
  versionsLabel,
  onToggleVersions,
  isVersionsOpen,
}: FlowsDrawerHeaderProps) => (
  <FlowDrawerHeader>
    {open ? (
      <>
        <Box display="flex" alignItems="center" flex={1} minWidth={0}>
          <Typography variant="subtitle1" fontWeight={600} noWrap>
            {title}
          </Typography>
        </Box>
        <Box display="flex" alignItems="center" gap={0.5}>
          <Tooltip title={versionsLabel}>
            <IconButton
              size="small"
              onClick={onToggleVersions}
              color={isVersionsOpen ? "primary" : "default"}
              aria-pressed={isVersionsOpen}
            >
              <History size={16} />
            </IconButton>
          </Tooltip>
          <Tooltip title={yamlLabel}>
            <IconButton
              size="small"
              onClick={onToggleYaml}
              color={isYamlOpen ? "primary" : "default"}
              aria-pressed={isYamlOpen}
            >
              <Badge
                badgeContent={yamlIssueCount}
                color="error"
                max={9}
                overlap="circular"
                invisible={!yamlIssueCount}
              >
                <Code size={16} />
              </Badge>
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={onToggle}>
            <ChevronLeft size={16} />
          </IconButton>
        </Box>
      </>
    ) : (
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        width="100%"
      >
        <IconButton size="small" onClick={onToggle} aria-label="toggle-drawer">
          <ChevronRight size={16} />
        </IconButton>
      </Box>
    )}
  </FlowDrawerHeader>
);
