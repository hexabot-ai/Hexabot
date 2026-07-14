/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Workflow, WorkflowVersion } from "@hexabot-ai/types";
import { useCallback, useEffect, useRef, useState } from "react";

import { useUpdate } from "@/hooks/crud/useUpdate";
import { EntityType } from "@/services/types";

import {
  resolveRedoIntent,
  resolveUndoIntent,
  shouldClearRedoStack,
} from "../utils/workflow-version-navigation.utils";

type UseWorkflowVersionNavigationArgs = {
  workflow?: Workflow;
  currentVersion?: WorkflowVersion | null;
  isDefinitionDirty: boolean;
  isSaving: boolean;
  revertLocalEdits: () => void;
};

/**
 * Undo/Redo over the workflow version chain: undo moves the workflow
 * `currentVersion` pointer to the version's `parentVersion`, redo moves it
 * forward again through a session-local stack of undone version ids. No new
 * version rows are created — navigation only re-points `currentVersion`.
 */
export const useWorkflowVersionNavigation = ({
  workflow,
  currentVersion,
  isDefinitionDirty,
  isSaving,
  revertLocalEdits,
}: UseWorkflowVersionNavigationArgs) => {
  const [redoStack, setRedoStack] = useState<string[]>([]);
  // Pointer value expected after our own undo/redo PATCH; any other pointer
  // move (commit, restore, publish-by-version, workflow switch) clears redo.
  const expectedPointerRef = useRef<string | null>(null);
  const { mutate: navigateWorkflowVersion, isPending: isNavigatingVersion } =
    useUpdate(EntityType.WORKFLOW);

  useEffect(() => {
    const pointer = workflow?.currentVersion ?? null;

    if (shouldClearRedoStack(expectedPointerRef.current, pointer)) {
      setRedoStack((prev) => (prev.length ? [] : prev));
    }

    expectedPointerRef.current = null;
  }, [workflow?.id, workflow?.currentVersion]);

  const undo = useCallback(() => {
    if (!workflow?.id || isSaving || isNavigatingVersion) {
      return;
    }

    const intent = resolveUndoIntent({ isDefinitionDirty, currentVersion });

    if (!intent) {
      return;
    }

    if (intent.kind === "revert-local") {
      revertLocalEdits();

      return;
    }

    expectedPointerRef.current = intent.targetId;
    navigateWorkflowVersion(
      { id: workflow.id, params: { currentVersion: intent.targetId } },
      {
        onSuccess: () => {
          setRedoStack((prev) => [...prev, intent.previousId]);
        },
        onError: () => {
          expectedPointerRef.current = null;
        },
      },
    );
  }, [
    workflow?.id,
    isSaving,
    isNavigatingVersion,
    isDefinitionDirty,
    currentVersion,
    revertLocalEdits,
    navigateWorkflowVersion,
  ]);
  const redo = useCallback(() => {
    if (!workflow?.id || isSaving || isNavigatingVersion) {
      return;
    }

    const intent = resolveRedoIntent({ isDefinitionDirty, redoStack });

    if (!intent) {
      return;
    }

    expectedPointerRef.current = intent.targetId;
    navigateWorkflowVersion(
      { id: workflow.id, params: { currentVersion: intent.targetId } },
      {
        onSuccess: () => {
          setRedoStack((prev) => prev.slice(0, -1));
        },
        onError: () => {
          expectedPointerRef.current = null;
        },
      },
    );
  }, [
    workflow?.id,
    isSaving,
    isNavigatingVersion,
    isDefinitionDirty,
    redoStack,
    navigateWorkflowVersion,
  ]);
  const canUndo =
    !isSaving &&
    !isNavigatingVersion &&
    (isDefinitionDirty || !!currentVersion?.parentVersion);
  const canRedo =
    !isSaving &&
    !isNavigatingVersion &&
    !isDefinitionDirty &&
    redoStack.length > 0;

  return { undo, redo, canUndo, canRedo, isNavigatingVersion };
};
