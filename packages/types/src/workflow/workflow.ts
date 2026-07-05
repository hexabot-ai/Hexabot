/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

import { asId, withAliases } from "../shared/aliases";
import { baseStubSchema } from "../shared/base";
import { cloneWithPrototype, toRecord } from "../shared/object";
import { preprocess } from "../shared/preprocess";
import { userSchema } from "../user/user";

import {
  directionTypeSchema,
  WebhookAuthType,
  webhookJwtAlgorithmSchema,
  workflowTypeSchema,
} from "./domain";
import { nullishToNull } from "./helpers";
import { workflowVersionSchema } from "./workflow-version";

const nullableString = preprocess(
  nullishToNull,
  z.string().nullable().optional(),
);
const webhookTriggerBaseShape = {
  enabled: z.coerce.boolean().default(false),
};

// Secrets are never stored inline on the workflow: each secret lives in the
// credentials store and the trigger config only carries its credential id.
export const webhookTriggerSchema = preprocess(
  (value) => {
    // Default the discriminator so a config without an explicit authType still
    // validates as an unauthenticated webhook (matches the previous behaviour).
    const record = toRecord(value);
    if (record && record.authType == null) {
      return { ...record, authType: WebhookAuthType.none };
    }

    return value;
  },
  z
    .discriminatedUnion("authType", [
      z.object({
        ...webhookTriggerBaseShape,
        authType: z.literal(WebhookAuthType.none),
      }),
      z.object({
        ...webhookTriggerBaseShape,
        authType: z.literal(WebhookAuthType.basic),
        username: nullableString,
        passwordCredentialId: nullableString,
      }),
      z.object({
        ...webhookTriggerBaseShape,
        authType: z.literal(WebhookAuthType.header),
        headerName: nullableString,
        headerValueCredentialId: nullableString,
      }),
      z.object({
        ...webhookTriggerBaseShape,
        authType: z.literal(WebhookAuthType.jwt),
        jwtSecretCredentialId: nullableString,
        jwtAlgorithm: preprocess(
          nullishToNull,
          webhookJwtAlgorithmSchema.nullable().optional(),
        ),
      }),
    ])
    // An enabled webhook with an unset credential reference would otherwise
    // authenticate empty credentials, so references are mandatory once
    // enabled.
    .superRefine((config, ctx) => {
      if (!config.enabled) {
        return;
      }

      const requireCredential = (
        field: string,
        value: string | null | undefined,
      ) => {
        if (!value) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: `${field} is required when the webhook trigger is enabled`,
          });
        }
      };

      switch (config.authType) {
        case WebhookAuthType.basic:
          requireCredential("username", config.username);
          requireCredential(
            "passwordCredentialId",
            config.passwordCredentialId,
          );
          break;
        case WebhookAuthType.header:
          requireCredential("headerName", config.headerName);
          requireCredential(
            "headerValueCredentialId",
            config.headerValueCredentialId,
          );
          break;
        case WebhookAuthType.jwt:
          requireCredential(
            "jwtSecretCredentialId",
            config.jwtSecretCredentialId,
          );
          break;
        default:
          break;
      }
    }),
);

export type WebhookTriggerConfig = z.infer<typeof webhookTriggerSchema>;

export type WorkflowDefinitionParser = (definitionYml: string) => unknown;
const workflowAliasMap = {
  currentVersionId: "currentVersion",
  publishedVersionId: "publishedVersion",
  createdById: "createdBy",
} as const;
const workflowStubObjectSchema = baseStubSchema.extend({
  name: z.string(),
  description: preprocess(nullishToNull, z.string().nullable()),
  type: workflowTypeSchema,
  schedule: preprocess(nullishToNull, z.string().nullable()),
  inputSchema: z.any(),
  builtin: z.coerce.boolean(),
  x: z.coerce.number(),
  y: z.coerce.number(),
  zoom: z.coerce.number(),
  direction: directionTypeSchema,
  webhookTrigger: preprocess(
    nullishToNull,
    webhookTriggerSchema.nullable(),
  ).optional(),
});
const withWorkflowAliases = (value: unknown): unknown => {
  const original = toRecord(value);
  const aliased = withAliases(value, workflowAliasMap);
  const record = toRecord(aliased);
  if (!record) {
    return aliased;
  }

  const next = cloneWithPrototype(record);
  const hasExplicitCurrentVersion = !!original && "currentVersion" in original;
  const hasExplicitPublishedVersion =
    !!original && "publishedVersion" in original;
  const hasCurrentVersion = next.currentVersion != null;

  if (!hasExplicitCurrentVersion && next.currentVersion == null) {
    delete next.currentVersion;
  }

  if (
    !hasExplicitPublishedVersion &&
    next.publishedVersion == null &&
    !hasCurrentVersion
  ) {
    delete next.publishedVersion;
  }

  return next;
};
const workflowDefinitionSchema = z.any();
const withWorkflowDerivedFields = (
  value: unknown,
  parseDefinition?: WorkflowDefinitionParser,
): unknown => {
  const record = toRecord(value);
  if (!record) {
    return value;
  }

  const next = cloneWithPrototype(record);
  const currentVersion = toRecord(next.currentVersion);
  const currentDefinitionYml =
    typeof next.definitionYml === "string"
      ? next.definitionYml
      : typeof currentVersion?.definitionYml === "string"
        ? currentVersion.definitionYml
        : undefined;

  if (next.definitionYml === undefined && currentDefinitionYml !== undefined) {
    next.definitionYml = currentDefinitionYml;
  }

  if (
    next.definition === undefined &&
    typeof currentDefinitionYml === "string" &&
    currentDefinitionYml.trim() !== "" &&
    parseDefinition
  ) {
    next.definition = parseDefinition(currentDefinitionYml);
  }

  return next;
};
const workflowFullObjectSchema = workflowStubObjectSchema.extend({
  currentVersion: preprocess(
    (value) => (value == null ? null : value),
    z.lazy(() => workflowVersionSchema).nullable(),
  ),
  publishedVersion: preprocess(
    (value) => (value == null ? null : value),
    z.lazy(() => workflowVersionSchema).nullable(),
  ),
  createdBy: preprocess(
    (value) => (value == null ? null : value),
    z.lazy(() => userSchema).nullable(),
  ),
  definitionYml: preprocess(
    (value) => (value == null ? undefined : value),
    z.string().optional(),
  ).optional(),
  definition: preprocess(
    (value) => (value == null ? undefined : value),
    workflowDefinitionSchema.optional(),
  ).optional(),
});

export const workflowStubSchema = workflowStubObjectSchema;

export const workflowSchema = preprocess(
  withWorkflowAliases,
  workflowStubObjectSchema.extend({
    currentVersion: preprocess(
      (value) =>
        value === undefined ? undefined : value == null ? null : asId(value),
      z.string().nullable().optional(),
    ).optional(),
    publishedVersion: preprocess(
      (value) =>
        value === undefined ? undefined : value == null ? null : asId(value),
      z.string().nullable().optional(),
    ).optional(),
    createdBy: preprocess(
      (value) => (value == null ? null : asId(value)),
      z.string().nullable(),
    ),
    runAfterMs: preprocess(
      (value) => (value == null ? 0 : value),
      z.coerce.number(),
    ),
  }),
);

export const createWorkflowFullSchema = (options?: {
  parseDefinition?: WorkflowDefinitionParser;
}) => {
  return preprocess(
    (value) => withWorkflowDerivedFields(value, options?.parseDefinition),
    workflowFullObjectSchema,
  );
};

export const workflowFullSchema = createWorkflowFullSchema();

export type WorkflowStub = z.infer<typeof workflowStubSchema>;

export type Workflow = z.infer<typeof workflowSchema>;

export type WorkflowFull = z.infer<typeof workflowFullSchema>;
