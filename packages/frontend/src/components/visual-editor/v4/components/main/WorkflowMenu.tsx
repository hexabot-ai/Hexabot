/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import { Download, Trash2 } from "lucide-react";

export type WorkflowMenuProps = {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  onExport?: () => void;
  onDelete: () => void;
  exportLabel?: string;
  deleteLabel: string;
  exportDisabled?: boolean;
  deleteDisabled?: boolean;
};

export const WorkflowMenu = ({
  anchorEl,
  open,
  onClose,
  onExport,
  onDelete,
  exportLabel,
  deleteLabel,
  exportDisabled = false,
  deleteDisabled = false,
}: WorkflowMenuProps) => (
  <Menu anchorEl={anchorEl} open={open} onClose={onClose}>
    {onExport && exportLabel && (
      <MenuItem onClick={onExport} disabled={exportDisabled}>
        <ListItemIcon>
          <Download size={18} />
        </ListItemIcon>
        <ListItemText primary={exportLabel} />
      </MenuItem>
    )}
    <MenuItem onClick={onDelete} disabled={deleteDisabled}>
      <ListItemIcon>
        <Trash2 size={18} />
      </ListItemIcon>
      <ListItemText primary={deleteLabel} />
    </MenuItem>
  </Menu>
);
