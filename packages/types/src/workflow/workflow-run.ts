/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

import { threadSchema } from "../chat/thread";
import { asId, withAliases } from "../shared/aliases";
import { baseStubSchema } from "../shared/base";
import { cloneWithPrototype, toRecord } from "../shared/object";
import { preprocess } from "../shared/preprocess";

import {
  nullishToNull,
  parseUserOrSubscriber,
  userOrSubscriberSchema,
} from "./helpers";
import { workflowSchema } from "./workflow";
import { workflowVersionSchema } from "./workflow-version";

const workflowRunStatusSchema = z.enum([
  "idle",
  "running",
  "suspended",
  "finished",
  "failed",
]);
const resolveTimestampMs = (value?: Date | string | null): number | null => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();

  return Number.isNaN(timestamp) ? null : timestamp;
};

export const resolveRunDurationMs = (run: {
  createdAt?: Date | string | null;
  finishedAt?: Date | string | null;
  failedAt?: Date | string | null;
  suspendedAt?: Date | string | null;
  status?: z.infer<typeof workflowRunStatusSchema> | null;
}): number | null => {
  const createdAtMs = resolveTimestampMs(run.createdAt);
  if (createdAtMs == null) {
    return null;
  }

  const endAtMs =
    resolveTimestampMs(run.finishedAt) ??
    resolveTimestampMs(run.failedAt) ??
    resolveTimestampMs(run.suspendedAt) ??
    (run.status === "running" ? Date.now() : null);

  if (endAtMs == null) {
    return null;
  }

  return Math.max(0, endAtMs - createdAtMs);
};

const workflowRunAliasMap = {
  workflowId: "workflow",
  workflowVersionId: "workflowVersion",
  triggeredById: "triggeredBy",
  threadId: "thread",
  parentRunId: "parentRun",
} as const;
const workflowRunStubObjectSchema = baseStubSchema.extend({
  status: workflowRunStatusSchema,
  input: preprocess(nullishToNull, z.record(z.string(), z.any()).nullable()),
  output: preprocess(nullishToNull, z.record(z.string(), z.any()).nullable()),
  context: preprocess(
    (value) => (value == null ? {} : value),
    z.record(z.string(), z.any()),
  ),
  snapshot: preprocess(nullishToNull, z.any().nullable()),
  stepLog: preprocess(nullishToNull, z.record(z.string(), z.any()).nullable()),
  checkpoint: preprocess(
    nullishToNull,
    z.record(z.string(), z.any()).nullable(),
  ),
  error: preprocess(nullishToNull, z.string().nullable()),
  /**
   * Id of the run that called this one. Unlike `parentRun`, it is kept once
   * that run is deleted.
   */
  callerRunId: preprocess(nullishToNull, z.string().nullable()),
  /** `true` while the run is suspended on a wait that only an admin resolves. */
  awaitingOperator: z.coerce.boolean().default(false),
  suspendedAt: preprocess(nullishToNull, z.coerce.date().nullable()),
  finishedAt: preprocess(nullishToNull, z.coerce.date().nullable()),
  failedAt: preprocess(nullishToNull, z.coerce.date().nullable()),
  duration: preprocess(nullishToNull, z.coerce.number().nullable()),
  metadata: preprocess(nullishToNull, z.record(z.string(), z.any()).nullable()),
});
const withWorkflowRunDuration = (value: unknown): unknown => {
  const record = toRecord(value);
  if (!record) {
    return value;
  }

  const next = cloneWithPrototype(record);
  next.duration = resolveRunDurationMs(next as never);

  return next;
};
const nullableUserOrSubscriberSchema = preprocess(
  (value) => (value == null ? null : parseUserOrSubscriber(value)),
  userOrSubscriberSchema.nullable(),
);

export const workflowRunStubSchema = preprocess(
  withWorkflowRunDuration,
  workflowRunStubObjectSchema,
);

export const workflowRunSchema = preprocess(
  (value) => withAliases(withWorkflowRunDuration(value), workflowRunAliasMap),
  workflowRunStubObjectSchema.extend({
    workflow: preprocess(
      (value) => (value == null ? null : asId(value)),
      z.string(),
    ),
    workflowVersion: preprocess(
      (value) => (value == null ? null : asId(value)),
      z.string().nullable(),
    ),
    triggeredBy: preprocess(
      (value) => (value == null ? null : asId(value)),
      z.string().nullable(),
    ),
    parentRun: preprocess(
      (value) => (value == null ? null : asId(value)),
      z.string().nullable(),
    ),
  }),
);

export const workflowRunFullSchema = preprocess(
  (value) => withWorkflowRunDuration(value),
  workflowRunStubObjectSchema.extend({
    workflow: workflowSchema,
    workflowVersion: z
      .lazy(() => workflowVersionSchema)
      .nullable()
      .optional(),
    triggeredBy: nullableUserOrSubscriberSchema,
    thread: threadSchema.nullable().optional(),
    parentRun: z
      .lazy(() => workflowRunSchema)
      .nullable()
      .optional(),
  }),
);

export type WorkflowRunStub = z.infer<typeof workflowRunStubSchema>;

export type WorkflowRun = z.infer<typeof workflowRunSchema>;

export type WorkflowRunFull = z.infer<typeof workflowRunFullSchema>;
