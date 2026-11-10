/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

import { nullableIdSchema, withAliases } from "../shared/aliases";
import { baseStubSchema } from "../shared/base";
import { nullableStringSchema, preprocess } from "../shared/preprocess";
import { credentialSchema } from "../user/credential";

import { mcpServerTransportSchema } from "./domain";

const mcpServerAliasMap = {
  credentialId: "credential",
} as const;
const mcpServerStubObjectSchema = baseStubSchema.extend({
  name: z.string(),
  enabled: z.coerce.boolean(),
  transport: mcpServerTransportSchema,
  url: nullableStringSchema,
  command: nullableStringSchema,
  args: preprocess(
    (value) => (value == null ? null : value),
    z.array(z.string()).nullable(),
  ),
  cwd: nullableStringSchema,
});

export const mcpServerStubSchema = mcpServerStubObjectSchema;

export const mcpServerSchema = preprocess(
  (value) => withAliases(value, mcpServerAliasMap),
  mcpServerStubObjectSchema.extend({
    credential: nullableIdSchema,
  }),
);

export const mcpServerFullSchema = mcpServerStubObjectSchema.extend({
  credential: preprocess(
    (value) => (value == null ? null : credentialSchema.parse(value)),
    credentialSchema.nullable(),
  ).optional(),
});

export type McpServerStub = z.infer<typeof mcpServerStubSchema>;

export type McpServer = z.infer<typeof mcpServerSchema>;

export type McpServerFull = z.infer<typeof mcpServerFullSchema>;
