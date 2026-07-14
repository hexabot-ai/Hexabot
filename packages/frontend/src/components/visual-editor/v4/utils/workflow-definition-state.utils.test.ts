/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowVersionAction } from "@hexabot-ai/types";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  applyWorkflowDefinitionStateUpdate,
  commitWorkflowDefinitionUpdate,
  type UpdateWorkflowDefinitionStateOptions,
} from "./workflow-definition-state.utils";

const SAVED_YAML = [
  "defs:",
  "  first_task:",
  "    kind: task",
  "    action: noop",
  "flow:",
  "  - do: first_task",
  "outputs:",
  "  result: =$output.first_task",
  "",
].join("\n");
const NEXT_YAML = [
  "defs:",
  "  next_task:",
  "    kind: task",
  "    action: noop",
  "flow:",
  "  - do: next_task",
  "outputs:",
  "  result: =$output.next_task",
  "",
].join("\n");
const createUpdateHarness = ({
  currentSignature = SAVED_YAML,
  savedDefinitionYml = SAVED_YAML,
}: {
  currentSignature?: string;
  savedDefinitionYml?: string;
} = {}) => {
  let signature = currentSignature;
  const setYaml = vi.fn();
  const scheduleDebouncedCommit = vi.fn();
  const clearDebouncedCommit = vi.fn();
  const commitImmediately = vi.fn();
  const apply = (
    nextDefinition: string,
    options?: UpdateWorkflowDefinitionStateOptions,
  ) =>
    applyWorkflowDefinitionStateUpdate({
      clearDebouncedCommit,
      commitImmediately,
      currentSignature: signature,
      nextDefinition,
      options,
      savedDefinitionYml,
      scheduleDebouncedCommit,
      setSignature: (nextSignature) => {
        signature = nextSignature;
      },
      setYaml,
    });

  return {
    apply,
    clearDebouncedCommit,
    commitImmediately,
    getSignature: () => signature,
    scheduleDebouncedCommit,
    setYaml,
  };
};

describe("workflow definition state persistence", () => {
  it("schedules YAML editor changes through the debounced commit path", () => {
    const harness = createUpdateHarness();

    harness.apply(NEXT_YAML, { persist: "debounced" });

    expect(harness.getSignature()).toBe(NEXT_YAML);
    expect(harness.setYaml).toHaveBeenCalledWith(NEXT_YAML);
    expect(harness.scheduleDebouncedCommit).toHaveBeenCalledWith(NEXT_YAML);
    expect(harness.commitImmediately).not.toHaveBeenCalled();
    expect(harness.clearDebouncedCommit).not.toHaveBeenCalled();
  });

  it("commits visual updates immediately by default", () => {
    const harness = createUpdateHarness();

    harness.apply(NEXT_YAML);

    expect(harness.getSignature()).toBe(NEXT_YAML);
    expect(harness.setYaml).toHaveBeenCalledWith(NEXT_YAML);
    expect(harness.clearDebouncedCommit).toHaveBeenCalledTimes(1);
    expect(harness.commitImmediately).toHaveBeenCalledWith(NEXT_YAML);
    expect(harness.scheduleDebouncedCommit).not.toHaveBeenCalled();
  });

  it("clears a pending debounced change before an immediate save", () => {
    const harness = createUpdateHarness({
      currentSignature: NEXT_YAML,
      savedDefinitionYml: SAVED_YAML,
    });

    harness.apply(NEXT_YAML);

    expect(harness.setYaml).not.toHaveBeenCalled();
    expect(harness.clearDebouncedCommit).toHaveBeenCalledTimes(1);
    expect(harness.commitImmediately).toHaveBeenCalledWith(NEXT_YAML);
    expect(harness.scheduleDebouncedCommit).not.toHaveBeenCalled();
  });

  it("does not create a workflow version for invalid YAML", () => {
    const commitVersion = vi.fn();
    const committed = commitWorkflowDefinitionUpdate({
      commitVersion,
      definitionYml: "defs: [",
      workflowId: "workflow-1",
    });

    expect(committed).toBe(false);
    expect(commitVersion).not.toHaveBeenCalled();
  });

  it("creates a workflow version for valid YAML", () => {
    const commitVersion = vi.fn();
    const committed = commitWorkflowDefinitionUpdate({
      commitVersion,
      definitionYml: NEXT_YAML,
      workflowId: "workflow-1",
    });

    expect(committed).toBe(true);
    expect(commitVersion).toHaveBeenCalledWith({
      action: WorkflowVersionAction.update,
      definitionYml: NEXT_YAML,
    });
  });

  it("does not create a version when a required action input is missing", () => {
    const commitVersion = vi.fn();
    const committed = commitWorkflowDefinitionUpdate({
      actions: {
        noop: {
          inputSchema: z.strictObject({ value: z.string() }),
          settingSchema: z.strictObject({}),
          supportedBindings: [],
        },
      },
      commitVersion,
      definitionYml: NEXT_YAML,
      workflowId: "workflow-1",
    });

    expect(committed).toBe(false);
    expect(commitVersion).not.toHaveBeenCalled();
  });
});
