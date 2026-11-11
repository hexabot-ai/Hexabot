/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { type PropsWithChildren } from "react";

import { BASE_ADD_DIALOG_MAP } from "@/app-components/dialogs/dialog.constants";
import { EntityDialogsContext } from "@/contexts/entity-dialogs.context";

/**
 * Provides the add dialog of each entity type. Mount it above the
 * DialogsProvider: the dialogs render next to its children, and the form
 * dialogs open further add dialogs from their entity selects.
 */
export const EntityDialogsProvider = ({ children }: PropsWithChildren) => (
  <EntityDialogsContext.Provider value={BASE_ADD_DIALOG_MAP}>
    {children}
  </EntityDialogsContext.Provider>
);
