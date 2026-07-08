/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { FC } from "react";

import { ContentTypeFormDialog } from "@/components/content-types/ContentTypeFormDialog";
import { ContentFormDialog } from "@/components/contents/ContentFormDialog";
import { CredentialFormDialog } from "@/components/credentials/CredentialFormDialog";
import { LabelFormDialog } from "@/components/labels/LabelFormDialog";
import { LanguageFormDialog } from "@/components/languages/LanguageFormDialog";
import { McpServerFormDialog } from "@/components/mcp-servers/McpServerFormDialog";
import { MemoryDefinitionFormDialog } from "@/components/memory-definitions/MemoryDefinitionFormDialog";
import { RoleFormDialog } from "@/components/roles/RoleFormDialog";
import { TranslationFormDialog } from "@/components/translations/TranslationFormDialog";
import { EntityType } from "@/services/types";
import { THook } from "@/types/base.types";
import {
  ComponentFormDialogProps,
  ComponentFormProps,
  OpenDialogOptions,
} from "@/types/common/dialogs.types";

export const BASE_ADD_DIALOG_MAP = {
  [EntityType.CONTENT_TYPE]: {
    dialog: ContentTypeFormDialog,
    presetValues: undefined,
  },
  [EntityType.CONTENT]: {
    dialog: ContentFormDialog,
    presetValues: {} as unknown as THook<{
      entity: EntityType.CONTENT_TYPE;
    }>["basic"],
  },
  [EntityType.CREDENTIAL]: {
    dialog: CredentialFormDialog,
    presetValues: undefined,
  },
  [EntityType.LANGUAGE]: {
    dialog: LanguageFormDialog,
    presetValues: undefined,
  },
  [EntityType.LABEL]: {
    dialog: LabelFormDialog,
    presetValues: undefined,
  },
  [EntityType.MCP_SERVER]: {
    dialog: McpServerFormDialog,
    presetValues: undefined,
  },
  [EntityType.MEMORY_DEFINITION]: {
    dialog: MemoryDefinitionFormDialog,
    presetValues: undefined,
    options: { maxWidth: "lg" },
  },
  [EntityType.ROLE]: {
    dialog: RoleFormDialog,
    presetValues: undefined,
  },
  [EntityType.TRANSLATION]: {
    dialog: TranslationFormDialog,
    presetValues: undefined,
  },
} as const satisfies {
  [E in THook["entity"]]?: {
    dialog: FC<
      ComponentFormDialogProps<
        FC<ComponentFormProps<THook<{ entity: E }>["basic"], any>>
      >
    >;
    presetValues?: unknown;
    options?: OpenDialogOptions<THook<{ entity: E }>["basic"]>;
  };
};
