/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createContext } from "react";

import type { BASE_ADD_DIALOG_MAP } from "@/app-components/dialogs/dialog.constants";

/**
 * The add dialog of each entity type. The shared entity buttons read it from
 * this context instead of importing it, because those dialogs render the
 * buttons themselves (through AutoCompleteEntitySelect).
 */
export const EntityDialogsContext = createContext<
  typeof BASE_ADD_DIALOG_MAP | undefined
>(undefined);
