/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

import { asId, withAliases } from "../shared/aliases";
import { baseStubSchema } from "../shared/base";
import { nullableDateSchema, preprocess } from "../shared/preprocess";

import { userSchema } from "./user";

const mcpTokenAliasMap = {
  ownerId: "owner",
} as const;
const mcpTokenStubObjectSchema = baseStubSchema.extend({
  name: z.string(),
  tokenPrefix: z.string(),
  expiresAt: nullableDateSchema,
  lastUsedAt: nullableDateSchema,
  revokedAt: nullableDateSchema,
});

export const mcpTokenStubSchema = mcpTokenStubObjectSchema;

export const mcpTokenSchema = preprocess(
  (value) => withAliases(value, mcpTokenAliasMap),
  mcpTokenStubObjectSchema.extend({
    owner: preprocess(
      (value) => (value == null ? null : asId(value)),
      z.string(),
    ),
  }),
);

export const mcpTokenFullSchema = mcpTokenStubObjectSchema.extend({
  owner: preprocess(
    (value) => (value == null ? null : value),
    z.lazy(() => userSchema).nullable(),
  ),
});

export type McpTokenStub = z.infer<typeof mcpTokenStubSchema>;

export type McpToken = z.infer<typeof mcpTokenSchema>;

export type McpTokenFull = z.infer<typeof mcpTokenFullSchema>;
