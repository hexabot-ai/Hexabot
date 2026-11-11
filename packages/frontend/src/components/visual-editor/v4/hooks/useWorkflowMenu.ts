/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Workflow } from "@hexabot-ai/types";
import { useState, type MouseEvent as ReactMouseEvent } from "react";

import { useTranslate } from "@/hooks/useTranslate";

import type { WorkflowMenuProps } from "../components/main/WorkflowMenu";

import { useConfirmDeleteWorkflow } from "./useConfirmDeleteWorkflow";
import { useWorkflow } from "./useWorkflow";

/**
 * State and actions of the export/delete menu of a workflow. `resolveWorkflow`
 * finds the workflow the menu was opened for (`null` while it is closed).
 * Spread `menuProps` on a WorkflowMenu.
 */
export const useWorkflowMenu = (
  resolveWorkflow: (menuFlowId: string | null) => Workflow | undefined,
) => {
  const { t } = useTranslate();
  const {
    selectedFlowId,
    isDefinitionDirty,
    isSaving,
    isExportingWorkflow,
    exportWorkflow,
  } = useWorkflow();
  const confirmDeleteWorkflow = useConfirmDeleteWorkflow();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [menuFlowId, setMenuFlowId] = useState<string | null>(null);
  const menuWorkflow = resolveWorkflow(menuFlowId);
  // A workflow with unsaved edits is exported once they are saved.
  const exportDisabled =
    !menuWorkflow ||
    isExportingWorkflow ||
    isSaving ||
    (menuWorkflow.id === selectedFlowId && isDefinitionDirty);
  const openMenu = (event: ReactMouseEvent<HTMLElement>, flowId: string) => {
    setAnchorEl(event.currentTarget);
    setMenuFlowId(flowId);
  };
  const closeMenu = () => {
    setAnchorEl(null);
    setMenuFlowId(null);
  };
  const menuProps: WorkflowMenuProps = {
    anchorEl,
    open: Boolean(anchorEl),
    onClose: closeMenu,
    onExport: () => {
      if (menuWorkflow && !exportDisabled) {
        exportWorkflow(menuWorkflow.id);
      }
      closeMenu();
    },
    exportDisabled,
    exportLabel: t("visual_editor.flows_drawer.export_workflow"),
    onDelete: async () => {
      closeMenu();

      if (menuWorkflow) {
        await confirmDeleteWorkflow(menuWorkflow.id);
      }
    },
    deleteDisabled: Boolean(menuWorkflow?.builtin),
    deleteLabel: t("button.delete"),
  };

  return { openMenu, menuProps };
};
