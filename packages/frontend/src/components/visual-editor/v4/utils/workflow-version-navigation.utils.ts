/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

type WorkflowVersionRef = {
  id: string;
  parentVersion?: string | null;
};

export type ResolveUndoIntentArgs = {
  isDefinitionDirty: boolean;
  currentVersion?: WorkflowVersionRef | null;
};

export type ResolveRedoIntentArgs = {
  isDefinitionDirty: boolean;
  redoStack: string[];
};

export type WorkflowVersionUndoIntent =
  | { kind: "revert-local" }
  | { kind: "navigate"; targetId: string; previousId: string }
  | null;

export type WorkflowVersionRedoIntent = {
  kind: "navigate";
  targetId: string;
} | null;

export const resolveUndoIntent = ({
  isDefinitionDirty,
  currentVersion,
}: ResolveUndoIntentArgs): WorkflowVersionUndoIntent => {
  if (isDefinitionDirty) {
    // Unsaved local edits: the first undo step only reverts them back to the
    // saved baseline; version navigation starts on the next click.
    return { kind: "revert-local" };
  }

  if (!currentVersion?.parentVersion) {
    return null;
  }

  return {
    kind: "navigate",
    targetId: currentVersion.parentVersion,
    previousId: currentVersion.id,
  };
};

export const resolveRedoIntent = ({
  isDefinitionDirty,
  redoStack,
}: ResolveRedoIntentArgs): WorkflowVersionRedoIntent => {
  // Redoing over uncommitted edits would discard them and race the pending
  // debounced auto-commit, so redo is unavailable while dirty.
  if (isDefinitionDirty) {
    return null;
  }

  const targetId = redoStack.at(-1);

  return targetId ? { kind: "navigate", targetId } : null;
};

export const shouldClearRedoStack = (
  expectedPointer: string | null,
  pointer: string | null,
) => !expectedPointer || expectedPointer !== pointer;
