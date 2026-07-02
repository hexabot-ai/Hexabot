/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

import { asId, withAliases } from "../shared/aliases";
import { baseStubSchema } from "../shared/base";
import { preprocess } from "../shared/preprocess";

import { Action, modelIdentitySchema } from "./domain";
import { userSchema } from "./user";

export enum ApiTokenType {
  API = "api",
  MCP = "mcp",
}

const nullableDateSchema = preprocess(
  (value) => (value == null ? null : value),
  z.coerce.date().nullable(),
);
const apiTokenAliasMap = {
  ownerId: "owner",
} as const;

export const apiTokenScopeSchema = z.object({
  model: modelIdentitySchema,
  action: z.enum(Action),
});

const apiTokenStubObjectSchema = baseStubSchema.extend({
  name: z.string(),
  tokenPrefix: z.string(),
  tokenType: z.enum(ApiTokenType),
  scopes: preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(apiTokenScopeSchema),
  ),
  expiresAt: nullableDateSchema,
  lastUsedAt: nullableDateSchema,
  revokedAt: nullableDateSchema,
});

export const apiTokenStubSchema = apiTokenStubObjectSchema;

export const apiTokenSchema = preprocess(
  (value) => withAliases(value, apiTokenAliasMap),
  apiTokenStubObjectSchema.extend({
    owner: preprocess(
      (value) => (value == null ? null : asId(value)),
      z.string(),
    ),
  }),
);

export const apiTokenFullSchema = apiTokenStubObjectSchema.extend({
  owner: preprocess(
    (value) => (value == null ? null : value),
    z.lazy(() => userSchema).nullable(),
  ),
});

export type ApiTokenScope = z.infer<typeof apiTokenScopeSchema>;

export type ApiTokenStub = z.infer<typeof apiTokenStubSchema>;

export type ApiToken = z.infer<typeof apiTokenSchema>;

export type ApiTokenFull = z.infer<typeof apiTokenFullSchema>;
