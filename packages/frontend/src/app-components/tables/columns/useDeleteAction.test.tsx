/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from "@hexabot-ai/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DialogsContext } from "@/contexts/dialogs.context";

import { type ActionColumn, ColumnActionType } from "./getColumns";
import { useDeleteAction } from "./useDeleteAction";

type Row = { id: string; isDefault?: boolean };

const getDeleteAction = ({
  confirmed,
  isDisabled,
}: {
  confirmed: boolean;
  isDisabled?: (row: Row) => boolean;
}) => {
  const open = vi.fn().mockResolvedValue(confirmed);
  const deleteRow = vi.fn();
  const onRender = vi.fn<(action: ActionColumn<Row>) => void>();
  const Probe = ({
    onAction,
  }: {
    onAction: (action: ActionColumn<Row>) => void;
  }) => {
    onAction(useDeleteAction<Row>(deleteRow, isDisabled));

    return null;
  };

  renderToStaticMarkup(
    <DialogsContext.Provider value={{ open, close: vi.fn() }}>
      <Probe onAction={onRender} />
    </DialogsContext.Provider>,
  );

  const [action] = onRender.mock.calls[0] ?? [];

  if (!action) {
    throw new Error("useDeleteAction did not render");
  }

  return { action, open, deleteRow };
};

describe("useDeleteAction", () => {
  it("is a delete action that requires the delete permission", () => {
    const { action } = getDeleteAction({ confirmed: true });

    expect(action).toMatchObject({
      action: ColumnActionType.Delete,
      requires: [Action.DELETE],
    });
    expect(action).not.toHaveProperty("isDisabled");
  });

  it("deletes the row once the user confirms", async () => {
    const { action, open, deleteRow } = getDeleteAction({ confirmed: true });

    await action.onClick?.({ id: "row-1" });

    expect(open).toHaveBeenCalledTimes(1);
    expect(deleteRow).toHaveBeenCalledWith("row-1");
  });

  it("keeps the row when the user cancels", async () => {
    const { action, deleteRow } = getDeleteAction({ confirmed: false });

    await action.onClick?.({ id: "row-1" });

    expect(deleteRow).not.toHaveBeenCalled();
  });

  it("disables the action for the rows it is given", () => {
    const isDisabled = (row: Row) => Boolean(row.isDefault);
    const { action } = getDeleteAction({ confirmed: true, isDisabled });

    expect(action.isDisabled).toBe(isDisabled);
  });
});
