/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

import { asId, nullableIdSchema, withAliases } from "../shared/aliases";
import { baseStubSchema } from "../shared/base";
import { preprocess } from "../shared/preprocess";
import { userSchema } from "../user/user";

import { workflowVersionActionSchema } from "./domain";
import { nullishToNull } from "./helpers";
import { workflowSchema } from "./workflow";
const workflowVersionAliasMap = {
  parentVersionId: "parentVersion",
  workflowId: "workflow",
  createdById: "createdBy",
} as const;
const workflowVersionStubObjectSchema = baseStubSchema.extend({
  version: z.coerce.number(),
  definitionYml: z.string(),
  checksum: z.string(),
  message: preprocess(nullishToNull, z.string().nullable()),
  action: preprocess(nullishToNull, workflowVersionActionSchema.nullable()),
});

export const workflowVersionStubSchema = workflowVersionStubObjectSchema;

export const workflowVersionSchema = preprocess(
  (value) => withAliases(value, workflowVersionAliasMap),
  workflowVersionStubObjectSchema.extend({
    parentVersion: nullableIdSchema,
    workflow: preprocess(
      (value) => (value == null ? null : asId(value)),
      z.string(),
    ),
    createdBy: nullableIdSchema,
  }),
);

export const workflowVersionFullSchema = workflowVersionStubObjectSchema.extend(
  {
    parentVersion: preprocess(
      nullishToNull,
      z.lazy(() => workflowVersionSchema).nullable(),
    ),
    workflow: z.lazy(() => workflowSchema),
    createdBy: preprocess(
      (value) => (value == null ? null : value),
      z.lazy(() => userSchema).nullable(),
    ),
  },
);

export type WorkflowVersionStub = z.infer<typeof workflowVersionStubSchema>;

export type WorkflowVersion = z.infer<typeof workflowVersionSchema>;

export type WorkflowVersionFull = z.infer<typeof workflowVersionFullSchema>;
