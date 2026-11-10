/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

import { nullableIdSchema, withAliases } from "../shared/aliases";
import { baseStubSchema } from "../shared/base";
import { preprocess } from "../shared/preprocess";

import { labelGroupSchema } from "./label-group";
import { subscriberSchema } from "./subscriber";

const nullableOptionalStringSchema = z.string().nullable().optional();
const labelAliasMap = {
  groupId: "group",
} as const;
const labelStubObjectSchema = baseStubSchema.extend({
  title: z.string(),
  name: z.string(),
  description: nullableOptionalStringSchema,
  builtin: z.coerce.boolean(),
});

export const labelStubSchema = labelStubObjectSchema;

export const labelSchema = preprocess(
  (value) => withAliases(value, labelAliasMap),
  labelStubObjectSchema.extend({
    group: nullableIdSchema.optional(),
    users: preprocess(() => undefined, z.undefined().optional()).optional(),
  }),
);

export const labelFullSchema = labelStubObjectSchema.extend({
  users: preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(z.lazy(() => subscriberSchema)),
  ).optional(),
  group: z
    .lazy(() => labelGroupSchema)
    .nullable()
    .optional(),
});

export type LabelStub = z.infer<typeof labelStubSchema>;

export type Label = z.infer<typeof labelSchema>;

export type LabelFull = z.infer<typeof labelFullSchema>;
