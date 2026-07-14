/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { IconButton, Tooltip } from "@mui/material";
import { Redo2, Undo2 } from "lucide-react";

import { TitleBarCard } from "./TitleBarCard";

type WorkflowUndoRedoButtonsProps = {
  undoLabel: string;
  redoLabel: string;
  onUndo: () => void;
  onRedo: () => void;
  undoDisabled?: boolean;
  redoDisabled?: boolean;
};

export const WorkflowUndoRedoButtons = ({
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
  undoDisabled = false,
  redoDisabled = false,
}: WorkflowUndoRedoButtonsProps) => (
  <TitleBarCard
    sx={{
      justifyContent: "center",
      flexShrink: 0,
      gap: 0.5,
    }}
  >
    <Tooltip title={undoLabel} arrow>
      <span>
        <IconButton
          size="medium"
          aria-label={undoLabel}
          onClick={onUndo}
          disabled={undoDisabled}
          sx={{ flexShrink: 0 }}
        >
          <Undo2 size={16} />
        </IconButton>
      </span>
    </Tooltip>
    <Tooltip title={redoLabel} arrow>
      <span>
        <IconButton
          size="medium"
          aria-label={redoLabel}
          onClick={onRedo}
          disabled={redoDisabled}
          sx={{ flexShrink: 0 }}
        >
          <Redo2 size={16} />
        </IconButton>
      </span>
    </Tooltip>
  </TitleBarCard>
);
