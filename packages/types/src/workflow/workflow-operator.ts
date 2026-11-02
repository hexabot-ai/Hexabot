/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

/**
 * Wait reason of the `await_approval` action: the run waits until an admin
 * approves or rejects it.
 */
export const AWAITING_APPROVAL_REASON = "awaiting_approval";

/**
 * Wait reason of the `suspend_workflow` action: the run waits until an admin
 * resumes it, optionally with a JSON payload.
 */
export const AWAITING_RESUME_REASON = "awaiting_resume";

/**
 * Reasons of the waits an admin (operator) resolves. Inbound events never
 * resolve them.
 */
export const WORKFLOW_OPERATOR_WAIT_REASONS = [
  AWAITING_APPROVAL_REASON,
  AWAITING_RESUME_REASON,
] as const;

export type WorkflowOperatorWaitReason =
  (typeof WORKFLOW_OPERATOR_WAIT_REASONS)[number];

const detailsSchema = z.record(z.string(), z.any()).nullable().optional();

/** `data` of an `awaiting_approval` wait, as stored in `checkpoint.waits`. */
export const workflowApprovalWaitDataSchema = z.object({
  message: z.string(),
  details: detailsSchema,
});

/** `data` of an `awaiting_resume` wait, as stored in `checkpoint.waits`. */
export const workflowResumeWaitDataSchema = z.object({
  message: z.string().nullable().optional(),
  details: detailsSchema,
  /** JSON Schema the resume payload's `data` must satisfy, when declared. */
  payload_schema: z.record(z.string(), z.any()).nullable().optional(),
});

export type WorkflowApprovalWaitData = z.infer<
  typeof workflowApprovalWaitDataSchema
>;

export type WorkflowResumeWaitData = z.infer<
  typeof workflowResumeWaitDataSchema
>;
