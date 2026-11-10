/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createContext, useCallback, useContext, type MouseEvent } from "react";

import type {
  FlowStepPath,
  OnOpenInsertMenu,
} from "../types/workflow-path.types";

export type WorkflowInsertMenuContextValue = {
  onOpenInsertMenu?: OnOpenInsertMenu;
  showEdgeInsertControls: boolean;
};

export const WorkflowInsertMenuContext =
  createContext<WorkflowInsertMenuContextValue>({
    showEdgeInsertControls: true,
  });

export const useWorkflowInsertMenu = (): WorkflowInsertMenuContextValue =>
  useContext(WorkflowInsertMenuContext);

/** Click handler opening the insert menu at `insertPath`, anchored on the clicked button. */
export const useOpenInsertMenuHandler = (insertPath?: FlowStepPath) => {
  const { onOpenInsertMenu } = useWorkflowInsertMenu();

  return useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (!insertPath) {
        return;
      }

      onOpenInsertMenu?.(event.currentTarget, insertPath);
    },
    [insertPath, onOpenInsertMenu],
  );
};
