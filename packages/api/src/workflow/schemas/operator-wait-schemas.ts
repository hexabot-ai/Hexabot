/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { JsonValueSchema } from '@hexabot-ai/agentic';
import { z, ZodType } from 'zod';

/** Longest comment or cancellation reason an admin can send. */
export const OPERATOR_TEXT_MAX_LENGTH = 2000;

/** Admin who resolved an operator wait. */
export const operatorActorSchema = z.object({
  id: z.string().min(1).meta({
    title: 'ID',
    description: 'Identifier of the admin user.',
  }),
  name: z.string().meta({
    title: 'Name',
    description: 'Display name of the admin user.',
  }),
});

/**
 * Payload an `awaiting_approval` wait accepts. The API builds it from the
 * authenticated admin; clients only choose the decision and the comment.
 */
export const approvalDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']).meta({
    title: 'Decision',
    description: 'Whether the request was approved or rejected.',
  }),
  decided_by: operatorActorSchema.meta({
    title: 'Decided by',
    description: 'Admin user who made the decision.',
  }),
  decided_at: z.iso.datetime().meta({
    title: 'Decided at',
    description: 'ISO timestamp of the decision.',
  }),
  comment: z.string().max(OPERATOR_TEXT_MAX_LENGTH).optional().meta({
    title: 'Comment',
    description: 'Optional comment left by the admin.',
  }),
});

/** Any JSON object, the default payload of an `awaiting_resume` wait. */
export const jsonObjectSchema = z.record(z.string(), JsonValueSchema);

/**
 * Build the payload an `awaiting_resume` wait accepts: the admin's `data`,
 * checked against `dataSchema`, and who resumed the run.
 *
 * @param dataSchema - Schema of the data the admin must send.
 */
export const buildResumePayloadSchema = <T>(dataSchema: ZodType<T>) =>
  z.object({
    data: dataSchema,
    resumed_by: operatorActorSchema,
    resumed_at: z.iso.datetime(),
  });

export type OperatorActor = z.infer<typeof operatorActorSchema>;

export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export type ResumePayload<T = Record<string, unknown>> = {
  data: T;
  resumed_by: OperatorActor;
  resumed_at: string;
};

/**
 * Describe the session user who resolves an operator wait.
 *
 * @param user - Session user (`req.session.passport.user`).
 * @returns The actor, named after the user's full name, or its id.
 */
export const toOperatorActor = (user: {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
}): OperatorActor => {
  const name = [user.first_name, user.last_name]
    .filter((part): part is string => typeof part === 'string' && !!part)
    .join(' ')
    .trim();

  return { id: user.id, name: name || user.id };
};
