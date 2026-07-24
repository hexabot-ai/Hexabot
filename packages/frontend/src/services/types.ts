/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { IEntityMapTypes } from "@/types/base.types";
import { UseMutationOptions } from "@/types/tanstack.types";

import { RouteParams } from "./api.class";

export enum EntityType {
  SUBSCRIBER = "Subscriber",
  LABEL = "Label",
  LABEL_GROUP = "LabelGroup",
  ROLE = "Role",
  USER = "User",
  PERMISSION = "Permission",
  MODEL = "Model",
  CREDENTIAL = "Credential",
  MENUTREE = "Menu/tree",
  CONTENT = "Content",
  CONTENT_TYPE = "ContentType",
  SETTING = "Setting",
  MESSAGE = "Message",
  MENU = "Menu",
  LANGUAGE = "Language",
  TRANSLATION = "Translation",
  ATTACHMENT = "Attachment",
  CHANNEL = "Channel",
  SOURCE = "Source",
  HELPER = "Helper",
  STORAGE_HELPER = "StorageHelper",
  RAG_HELPER = "RagHelper",
  WORKFLOW = "Workflow",
  WORKFLOW_VERSION = "WorkflowVersion",
  WORKFLOW_RUN = "WorkflowRun",
  MCP_SERVER = "McpServer",
  MEMORY_DEFINITION = "MemoryDefinition",
  AUDIT_LOG = "AuditLog",
  THREAD = "Thread",
  STATS = "Stats",
}

export enum Format {
  NONE = 0,
  STUB = 1,
  BASIC = 2,
  FULL = 3,
}

export type TypeByFormat<
  F extends Format | undefined,
  TBasic,
  TFull,
> = F extends Format.FULL ? TFull : TBasic;

export type TCount = {
  count: number;
};

export enum RouterType {
  HOME = "/",
  LOGIN = "login",
  RESET = "reset",
  WORKFLOW_EDITOR = "workflow-editor",
  INBOX = "inbox",
  SETTINGS = "settings",
}

export const FULL_WIDTH_PATHNAMES: TRouterValues[] = [
  RouterType.WORKFLOW_EDITOR,
  RouterType.INBOX,
] as const;

export type TRouterValues = `${RouterType}`;

export type TMutationOptions<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown,
> = Omit<
  UseMutationOptions<TData, TError, TVariables, TContext>,
  "mutationFn" | "mutationKey"
> & {
  routeParams?: RouteParams;
};

export type TSetCacheProps<TData> = {
  id: string;
  payload?: Partial<TData>;
  preprocess?: (data: TData) => TData;
  strategy?: "merge" | "overwrite";
};

export type TPopulateTypeFromFormat<T> = T extends { format: Format.FULL }
  ? string[]
  : undefined;

export enum QueryType {
  item = "item",
  collection = "collection",
  count = "count",
  infinite = "infinite",
}

export const normalizeEntity = (entity: string): keyof IEntityMapTypes => {
  const entityTypeKey = Object.keys(EntityType).find(
    (key) => EntityType[key] === entity,
  );

  if (!entityTypeKey) {
    throw `Not existing entity: ${entity}`;
  }

  return EntityType[entityTypeKey];
};
