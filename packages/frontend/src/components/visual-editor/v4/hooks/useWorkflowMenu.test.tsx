/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Workflow } from "@hexabot-ai/types";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkflowMenuProps } from "../components/main/WorkflowMenu";

import { useWorkflowMenu } from "./useWorkflowMenu";

const editor = vi.hoisted(() => ({
  state: {
    selectedFlowId: "wf-1" as string | undefined,
    isDefinitionDirty: false,
    isSaving: false,
    isExportingWorkflow: false,
    exportWorkflow: (_id: string) => {},
  },
  confirmDeleteWorkflow: async (_id: string) => {},
}));

vi.mock("./useWorkflow", () => ({ useWorkflow: () => editor.state }));
vi.mock("./useConfirmDeleteWorkflow", () => ({
  useConfirmDeleteWorkflow: () => editor.confirmDeleteWorkflow,
}));
vi.mock("@/hooks/useTranslate", () => ({
  useTranslate: () => ({ t: (key: string) => key }),
}));

const workflow = { id: "wf-1", builtin: false } as Workflow;
const getMenuProps = (
  resolveWorkflow: (menuFlowId: string | null) => Workflow | undefined,
) => {
  const onRender = vi.fn<(props: WorkflowMenuProps) => void>();
  const Probe = ({
    onMenu,
  }: {
    onMenu: (props: WorkflowMenuProps) => void;
  }) => {
    onMenu(useWorkflowMenu(resolveWorkflow).menuProps);

    return null;
  };

  renderToStaticMarkup(<Probe onMenu={onRender} />);

  const [menuProps] = onRender.mock.calls[0] ?? [];

  if (!menuProps) {
    throw new Error("useWorkflowMenu did not render");
  }

  return menuProps;
};

describe("useWorkflowMenu", () => {
  beforeEach(() => {
    editor.state = {
      selectedFlowId: "wf-1",
      isDefinitionDirty: false,
      isSaving: false,
      isExportingWorkflow: false,
      exportWorkflow: vi.fn(),
    };
    editor.confirmDeleteWorkflow = vi.fn(async () => {});
  });

  it("starts closed and resolves the workflow without a menu id", () => {
    const resolveWorkflow = vi.fn(() => workflow);
    const menuProps = getMenuProps(resolveWorkflow);

    expect(resolveWorkflow).toHaveBeenCalledWith(null);
    expect(menuProps).toMatchObject({
      anchorEl: null,
      open: false,
      exportLabel: "visual_editor.flows_drawer.export_workflow",
      deleteLabel: "button.delete",
      deleteDisabled: false,
    });
  });

  it("exports the workflow of the menu", () => {
    const menuProps = getMenuProps(() => workflow);

    expect(menuProps.exportDisabled).toBe(false);
    menuProps.onExport?.();
    expect(editor.state.exportWorkflow).toHaveBeenCalledWith("wf-1");
  });

  it("disables export while saving, exporting or with unsaved edits", () => {
    for (const state of [
      { isSaving: true },
      { isExportingWorkflow: true },
      { isDefinitionDirty: true },
    ]) {
      Object.assign(editor.state, state);

      const menuProps = getMenuProps(() => workflow);

      expect(menuProps.exportDisabled).toBe(true);
      menuProps.onExport?.();
      expect(editor.state.exportWorkflow).not.toHaveBeenCalled();
      Object.assign(editor.state, {
        isSaving: false,
        isExportingWorkflow: false,
        isDefinitionDirty: false,
      });
    }
  });

  it("exports another workflow while the open one has unsaved edits", () => {
    editor.state.isDefinitionDirty = true;

    expect(
      getMenuProps(() => ({ ...workflow, id: "wf-2" }) as Workflow)
        .exportDisabled,
    ).toBe(false);
  });

  it("disables export without a workflow", () => {
    expect(getMenuProps(() => undefined).exportDisabled).toBe(true);
  });

  it("asks to delete the workflow of the menu", async () => {
    await getMenuProps(() => workflow).onDelete();

    expect(editor.confirmDeleteWorkflow).toHaveBeenCalledWith("wf-1");
  });

  it("disables delete for a built-in workflow", () => {
    expect(
      getMenuProps(() => ({ ...workflow, builtin: true }) as Workflow)
        .deleteDisabled,
    ).toBe(true);
  });
});
