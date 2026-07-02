/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

export enum Action {
  CREATE = "create",
  READ = "read",
  UPDATE = "update",
  DELETE = "delete",
}

export enum MethodToAction {
  POST = "create",
  GET = "read",
  PATCH = "update",
  DELETE = "delete",
}

export type TRelation = "role" | "createdBy";

export const modelIdentities = [
  "contenttype",
  "content",
  "nlpentity",
  "nlpsampleentity",
  "nlpsample",
  "nlpvalue",
  "setting",
  "attachment",
  "auditlog",
  "user",
  "role",
  "permission",
  "label",
  "labelgroup",
  "message",
  "thread",
  "subscriber",
  "source",
  "language",
  "translation",
  "stats",
  "menu",
  "workflow",
  "workflowversion",
  "workflowrun",
  "memorydefinition",
  "memoryrecord",
  "mcpserver",
  "model",
  "credential",
] as const;

export type TModel = (typeof modelIdentities)[number];

export type ModelPermissionsPerRole = Record<TModel, Action[]>;

export type PermissionsTree = Record<string, ModelPermissionsPerRole>;

export const relationSchema = z.enum(["role", "createdBy"]);

export const modelIdentitySchema = z.enum(modelIdentities);
