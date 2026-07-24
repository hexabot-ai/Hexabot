/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EntityType } from "@/services/types";

export const POPULATE_BY_TYPE = {
  [EntityType.WORKFLOW]: ["currentVersion", "publishedVersion"],
  [EntityType.WORKFLOW_VERSION]: ["parentVersion", "createdBy"],
  [EntityType.WORKFLOW_RUN]: [
    "workflow",
    "workflowVersion",
    "triggeredBy",
    "thread",
  ],
  [EntityType.AUDIT_LOG]: [],
  [EntityType.MCP_SERVER]: ["credential"],
  [EntityType.MEMORY_DEFINITION]: [],
  [EntityType.THREAD]: ["subscriber", "source"],
  [EntityType.ROLE]: ["users", "permissions"],
  [EntityType.USER]: ["roles", "avatar"],
  [EntityType.LABEL]: ["users", "group"],
  [EntityType.LABEL_GROUP]: [],
  [EntityType.MODEL]: ["permissions"],
  [EntityType.PERMISSION]: ["model", "role"],
  [EntityType.CREDENTIAL]: [],
  [EntityType.SUBSCRIBER]: ["labels", "assignedTo"],
  [EntityType.CONTENT_TYPE]: [],
  [EntityType.CONTENT]: ["entity"],
  [EntityType.SETTING]: [],
  [EntityType.MESSAGE]: ["sender", "recipient", "sentBy", "thread"],
  [EntityType.MENU]: ["parent"],
  [EntityType.MENUTREE]: [],
  [EntityType.LANGUAGE]: [],
  [EntityType.TRANSLATION]: [],
  [EntityType.ATTACHMENT]: ["createdBy"],
  [EntityType.CHANNEL]: [],
  [EntityType.SOURCE]: ["defaultWorkflow"],
  [EntityType.HELPER]: [],
  [EntityType.STORAGE_HELPER]: [],
  [EntityType.RAG_HELPER]: [],
  [EntityType.STATS]: [],
} as const;

export type Populate<C extends EntityType> =
  (typeof POPULATE_BY_TYPE)[C][number];
