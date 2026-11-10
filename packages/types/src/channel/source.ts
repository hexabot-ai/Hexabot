/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

import { nullableIdSchema, withAliases } from "../shared/aliases";
import { baseStubSchema } from "../shared/base";
import { preprocess } from "../shared/preprocess";

export const sourceAliasMap = {
  defaultWorkflowId: "defaultWorkflow",
} as const;

export const sourceObjectSchema = baseStubSchema.extend({
  name: z.string(),
  channel: z.string(),
  settings: preprocess(
    (value) =>
      value && typeof value === "object" && !Array.isArray(value) ? value : {},
    z.record(z.string(), z.unknown()),
  ),
  state: z.coerce.boolean(),
});

export const sourceStubSchema = sourceObjectSchema;

export const sourceSchema = preprocess(
  (value) => withAliases(value, sourceAliasMap),
  sourceObjectSchema.extend({
    defaultWorkflow: nullableIdSchema,
  }),
);

export type SourceStub = z.infer<typeof sourceStubSchema>;

export type Source = z.infer<typeof sourceSchema>;
