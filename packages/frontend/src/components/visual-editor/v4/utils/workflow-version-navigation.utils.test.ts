/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import {
  resolveRedoIntent,
  resolveUndoIntent,
  shouldClearRedoStack,
} from "./workflow-version-navigation.utils";

describe("resolveUndoIntent", () => {
  it("reverts local edits first when the definition is dirty", () => {
    expect(
      resolveUndoIntent({
        isDefinitionDirty: true,
        currentVersion: { id: "v2", parentVersion: "v1" },
      }),
    ).toEqual({ kind: "revert-local" });
  });

  it("navigates to the parent version when clean", () => {
    expect(
      resolveUndoIntent({
        isDefinitionDirty: false,
        currentVersion: { id: "v2", parentVersion: "v1" },
      }),
    ).toEqual({ kind: "navigate", targetId: "v1", previousId: "v2" });
  });

  it("returns null at the root version (no parent)", () => {
    expect(
      resolveUndoIntent({
        isDefinitionDirty: false,
        currentVersion: { id: "v0", parentVersion: null },
      }),
    ).toBeNull();
  });

  it("returns null when there is no current version", () => {
    expect(
      resolveUndoIntent({ isDefinitionDirty: false, currentVersion: null }),
    ).toBeNull();
  });
});

describe("resolveRedoIntent", () => {
  it("navigates to the most recently undone version", () => {
    expect(
      resolveRedoIntent({ isDefinitionDirty: false, redoStack: ["v2", "v3"] }),
    ).toEqual({ kind: "navigate", targetId: "v3" });
  });

  it("returns null when the redo stack is empty", () => {
    expect(
      resolveRedoIntent({ isDefinitionDirty: false, redoStack: [] }),
    ).toBeNull();
  });

  it("returns null while the definition is dirty", () => {
    expect(
      resolveRedoIntent({ isDefinitionDirty: true, redoStack: ["v3"] }),
    ).toBeNull();
  });
});

describe("shouldClearRedoStack", () => {
  it("keeps the stack when the pointer matches the expected undo/redo target", () => {
    expect(shouldClearRedoStack("v1", "v1")).toBe(false);
  });

  it("clears the stack on an external pointer move", () => {
    expect(shouldClearRedoStack(null, "v4")).toBe(true);
    expect(shouldClearRedoStack("v1", "v4")).toBe(true);
  });
});
