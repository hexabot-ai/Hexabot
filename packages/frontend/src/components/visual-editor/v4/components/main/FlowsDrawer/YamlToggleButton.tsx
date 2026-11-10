/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Badge, IconButton, Tooltip } from "@mui/material";
import { Code } from "lucide-react";

export type YamlToggleButtonProps = {
  label: string;
  onToggle: () => void;
  isOpen: boolean;
  issueCount: number;
};

export const YamlToggleButton = ({
  label,
  onToggle,
  isOpen,
  issueCount,
}: YamlToggleButtonProps) => (
  <Tooltip title={label}>
    <IconButton
      size="small"
      onClick={onToggle}
      color={isOpen ? "primary" : "default"}
      aria-pressed={isOpen}
    >
      <Badge
        badgeContent={issueCount}
        color="error"
        max={9}
        overlap="circular"
        invisible={!issueCount}
      >
        <Code size={16} />
      </Badge>
    </IconButton>
  </Tooltip>
);
