/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

export enum WorkflowType {
  conversational = "conversational",
  manual = "manual",
  scheduled = "scheduled",
}

export enum WorkflowVersionAction {
  create = "create",
  update = "update",
  restore = "restore",
  import = "import",
}

export enum MemoryScope {
  global = "global",
  workflow = "workflow",
  thread = "thread",
  run = "run",
}

export enum McpServerTransport {
  http = "http",
  stdio = "stdio",
}

export enum DirectionType {
  HORIZONTAL = "horizontal",
  VERTICAL = "vertical",
}

export enum WebhookAuthType {
  none = "none",
  basic = "basic",
  header = "header",
  jwt = "jwt",
}

export enum WebhookJwtAlgorithm {
  HS256 = "HS256",
  HS384 = "HS384",
  HS512 = "HS512",
}

export const workflowTypeSchema = z.enum(WorkflowType);

export const workflowVersionActionSchema = z.enum(WorkflowVersionAction);

export const memoryScopeSchema = z.enum(MemoryScope);

export const mcpServerTransportSchema = z.enum(McpServerTransport);

export const directionTypeSchema = z.enum(DirectionType);

export const webhookAuthTypeSchema = z.enum(WebhookAuthType);

export const webhookJwtAlgorithmSchema = z.enum(WebhookJwtAlgorithm);
