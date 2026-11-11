/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action } from "@hexabot-ai/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BASE_ADD_DIALOG_MAP } from "@/app-components/dialogs/dialog.constants";
import { DialogsContext } from "@/contexts/dialogs.context";
import { EntityDialogsContext } from "@/contexts/entity-dialogs.context";
import { PermissionContext } from "@/contexts/permission.context";
import { EntityType } from "@/services/types";

import { EntityButtonWrapper } from "./EntityButtonWrapper";

vi.mock("@/hooks/useTranslate", () => ({
  useTranslate: () => ({ t: (key: string) => key }),
}));

const LabelDialog = () => null;
const dialogMap = {
  [EntityType.LABEL]: { dialog: LabelDialog, presetValues: undefined },
} as unknown as typeof BASE_ADD_DIALOG_MAP;
const render = (
  entity: keyof typeof BASE_ADD_DIALOG_MAP,
  {
    allowedActions = [Action.CREATE],
    withDialogMap = true,
  }: { allowedActions?: Action[]; withDialogMap?: boolean } = {},
) => {
  const button = (
    <EntityButtonWrapper entity={entity} permissionAction={Action.CREATE} />
  );

  return renderToStaticMarkup(
    <PermissionContext.Provider
      value={{ getAllowedActions: () => allowedActions }}
    >
      <DialogsContext.Provider value={{ open: vi.fn(), close: vi.fn() }}>
        {withDialogMap ? (
          <EntityDialogsContext.Provider value={dialogMap}>
            {button}
          </EntityDialogsContext.Provider>
        ) : (
          button
        )}
      </DialogsContext.Provider>
    </PermissionContext.Provider>,
  );
};

describe("EntityButtonWrapper", () => {
  it("renders the add button of an entity the dialog map can create", () => {
    expect(render(EntityType.LABEL)).toContain("button.add");
  });

  it("renders nothing for an entity the provided dialog map lacks", () => {
    expect(render(EntityType.ROLE)).toBe("");
  });

  it("renders nothing without the permission to create the entity", () => {
    expect(render(EntityType.LABEL, { allowedActions: [Action.READ] })).toBe(
      "",
    );
  });

  it("requires an EntityDialogsProvider", () => {
    expect(() => render(EntityType.LABEL, { withDialogMap: false })).toThrow(
      "useEntityDialogMap must be used within an EntityDialogsProvider",
    );
  });
});
