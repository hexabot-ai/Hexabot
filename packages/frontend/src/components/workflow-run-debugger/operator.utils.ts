/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus, type WaitInfo } from "@hexabot-ai/agentic";
import {
  AWAITING_APPROVAL_REASON,
  AWAITING_RESUME_REASON,
  workflowApprovalWaitDataSchema,
  workflowResumeWaitDataSchema,
  type WorkflowRun,
} from "@hexabot-ai/types";
import type { RJSFSchema } from "@rjsf/utils";

import type { TTranslationKeys } from "@/i18n/i18n.types";
import { isRecord } from "@/utils/object";
import validator from "@/utils/rjsf-zod-validator";

import { getOpenWaits, resolveEntityId } from "./utils";

/** Operation an admin applies to a suspended run. */
export type OperatorAction = "approve" | "reject" | "resume" | "cancel";

/** Kind of wait an admin resolves. */
export type OperatorWaitKind = "approval" | "resume";

/** What an admin needs to know about an operator wait. */
export type OperatorWaitView = {
  kind: OperatorWaitKind;
  message: string | null;
  details: Record<string, unknown> | null;
  /** JSON Schema the resume data must satisfy (resume waits only). */
  payloadSchema: Record<string, unknown> | null;
};

/** Field-level refusal of a resume payload (`422 payload_rejected`). */
export type PayloadIssue = {
  /** Path inside the submitted data; empty for the data itself. */
  path: string;
  message: string;
};

type TranslatedMessage = {
  key: TTranslationKeys;
  params?: { 0?: string };
};

/** How to report a failed operator request. */
export type OperatorErrorDescriptor = TranslatedMessage & {
  severity: "error" | "warning";
  /** Server message shown when the key has no translation. */
  fallback?: string;
  /** The run changed (or may have): reload it and the pending list. */
  refreshRun: boolean;
  /** Shown inside the dialog, which stays open, instead of a toast. */
  inline: boolean;
  /** Already reported to the user (network errors are toasted globally). */
  silent: boolean;
  issues: PayloadIssue[];
};

/** How to report the run an operator request returned. */
export type OperatorOutcome = TranslatedMessage & {
  severity: "success" | "info" | "warning";
  /** Second sentence: what the run did next. */
  detail?: TranslatedMessage;
};

/** Error codes of the operator endpoints (`WorkflowRunOperatorService`). */
type OperatorErrorCode =
  | "wait_ambiguous"
  | "wait_kind_mismatch"
  | "run_not_suspended"
  | "wait_not_found"
  | "no_matching_wait"
  | "claim_lost"
  | "trigger_unavailable"
  | "unresumable"
  | "resume_unavailable"
  | "payload_rejected";

const OPERATOR_ERROR_CODES = new Set<string>([
  "wait_ambiguous",
  "wait_kind_mismatch",
  "run_not_suspended",
  "wait_not_found",
  "no_matching_wait",
  "claim_lost",
  "trigger_unavailable",
  "unresumable",
  "resume_unavailable",
  "payload_rejected",
] satisfies OperatorErrorCode[]);
/** Reasons a run's trigger cannot be rebuilt (`trigger_unavailable`). */
const TRIGGER_UNAVAILABLE_REASONS = new Set([
  "initiator_unavailable",
  "thread_unavailable",
  "thread_closed",
  "channel_unavailable",
  "source_disabled",
  "unsupported_trigger",
]);
/** Longest comment or cancellation reason the API accepts. */

export const OPERATOR_TEXT_MAX_LENGTH = 2000;

export const isApprovalWait = (wait: Pick<WaitInfo, "reason">): boolean =>
  wait.reason === AWAITING_APPROVAL_REASON;

export const isResumeWait = (wait: Pick<WaitInfo, "reason">): boolean =>
  wait.reason === AWAITING_RESUME_REASON;

export const isOperatorWait = (wait: Pick<WaitInfo, "reason">): boolean =>
  isApprovalWait(wait) || isResumeWait(wait);

/**
 * Read the open waits of a run that an admin resolves, in flow order.
 *
 * @param run - Run as cached.
 * @returns The operator waits, or none when the run is not suspended.
 */
export const getOperatorWaits = (
  run?: Pick<WorkflowRun, "status" | "checkpoint"> | null,
): WaitInfo[] => getOpenWaits(run).filter(isOperatorWait);

/**
 * Tell whether a wait is still open on the run as cached.
 */
export const isWaitOpen = (
  run: Pick<WorkflowRun, "status" | "checkpoint"> | null | undefined,
  waitId: string,
): boolean => getOpenWaits(run).some((wait) => wait.waitId === waitId);

/**
 * Describe an operator wait from its `data`, tolerating malformed data.
 *
 * @param wait - Open wait of a run.
 * @returns The wait's kind and data, or `null` for other waits.
 */
export const describeOperatorWait = (
  wait: WaitInfo,
): OperatorWaitView | null => {
  if (isApprovalWait(wait)) {
    const parsed = workflowApprovalWaitDataSchema.safeParse(wait.data);

    return {
      kind: "approval",
      message: parsed.success ? parsed.data.message : null,
      details: parsed.success ? (parsed.data.details ?? null) : null,
      payloadSchema: null,
    };
  }

  if (isResumeWait(wait)) {
    const parsed = workflowResumeWaitDataSchema.safeParse(wait.data);

    return {
      kind: "resume",
      message: parsed.success ? (parsed.data.message ?? null) : null,
      details: parsed.success ? (parsed.data.details ?? null) : null,
      payloadSchema: parsed.success
        ? (parsed.data.payload_schema ?? null)
        : null,
    };
  }

  return null;
};

/**
 * Pick the schema a resume form can render: an object schema with properties
 * that zod can read. Anything else is edited as raw JSON and left to the API
 * to check.
 *
 * @param payloadSchema - `payload_schema` of a resume wait.
 * @returns The form schema, or `null` to fall back to a JSON editor.
 */
export const getResumeFormSchema = (
  payloadSchema: Record<string, unknown> | null | undefined,
): RJSFSchema | null => {
  if (!isRecord(payloadSchema)) {
    return null;
  }

  const { type, properties } = payloadSchema;

  if (type !== undefined && type !== "object") {
    return null;
  }

  if (!isRecord(properties) || Object.keys(properties).length === 0) {
    return null;
  }

  const schema = payloadSchema as RJSFSchema;
  const { validationError } = validator.rawValidation(schema, {});

  return validationError ? null : schema;
};

export type ParsedJsonObject =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: "invalid" | "not_object" };

/**
 * Parse the text of a JSON editor that must hold a JSON object.
 */
export const parseJsonObject = (text: string): ParsedJsonObject => {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  return isRecord(value)
    ? { ok: true, value }
    : { ok: false, reason: "not_object" };
};

/**
 * Tell whether every value of a record is a scalar, so it reads well as a
 * key/value list.
 */
export const isFlatPrimitiveRecord = (
  value: unknown,
): value is Record<string, string | number | boolean | null> =>
  isRecord(value) &&
  Object.values(value).every(
    (entry) =>
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean",
  );

/**
 * Split the `issues` of a `422 payload_rejected` error (`"<path>: <message>"`)
 * into paths relative to the submitted data.
 */
export const parsePayloadIssues = (issues: unknown): PayloadIssue[] => {
  if (!Array.isArray(issues)) {
    return [];
  }

  return issues
    .filter((issue): issue is string => typeof issue === "string")
    .map((issue) => {
      const separator = issue.indexOf(": ");

      if (separator === -1) {
        return { path: "", message: issue };
      }

      const rawPath = issue.slice(0, separator);
      const path =
        rawPath === "data" || rawPath === "(root)"
          ? ""
          : rawPath.replace(/^data\./, "");

      return { path, message: issue.slice(separator + 2) };
    });
};

type ErrorBody = {
  statusCode?: unknown;
  code?: unknown;
  message?: unknown;
  reason?: unknown;
  issues?: unknown;
};

const toServerMessage = (message: unknown): string | undefined => {
  if (Array.isArray(message)) {
    return message.filter((part) => typeof part === "string").join(", ");
  }

  return typeof message === "string" && message ? message : undefined;
};
const errorDescriptor = (
  key: TTranslationKeys,
  overrides: Partial<OperatorErrorDescriptor> = {},
): OperatorErrorDescriptor => ({
  key,
  severity: "error",
  refreshRun: true,
  inline: false,
  silent: false,
  issues: [],
  ...overrides,
});

/**
 * Map an operator request failure (as rejected by the axios interceptor) to
 * the message to show and what to do next.
 *
 * @param error - `response.data` of the failed request, or the interceptor's
 * `Error("Network error")` when no response came back.
 */
export const getOperatorErrorDescriptor = (
  error: unknown,
): OperatorErrorDescriptor => {
  if (error instanceof Error) {
    // No response: the interceptor already reported it, but the request may
    // have reached the API, so the decision may have been applied.
    return errorDescriptor("message.operator_error.unknown_outcome", {
      severity: "warning",
      silent: true,
    });
  }

  const body = (isRecord(error) ? error : {}) as ErrorBody;
  const statusCode =
    typeof body.statusCode === "number" ? body.statusCode : undefined;

  if (statusCode === undefined || statusCode >= 500) {
    // A gateway timeout (HTML body) or a crash: the pass may still be running.
    return errorDescriptor("message.operator_error.unknown_outcome", {
      severity: "warning",
    });
  }

  const code =
    typeof body.code === "string" && OPERATOR_ERROR_CODES.has(body.code)
      ? (body.code as OperatorErrorCode)
      : undefined;
  const fallback = toServerMessage(body.message);

  switch (code) {
    case "payload_rejected":
      return errorDescriptor("message.operator_error.payload_rejected", {
        fallback,
        refreshRun: false,
        inline: true,
        issues: parsePayloadIssues(body.issues),
      });
    case "trigger_unavailable": {
      const reason =
        typeof body.reason === "string" &&
        TRIGGER_UNAVAILABLE_REASONS.has(body.reason)
          ? body.reason
          : "unknown";

      return errorDescriptor(
        `message.operator_error.trigger_unavailable.${reason}`,
        { fallback },
      );
    }
    case undefined:
      break;
    default:
      return errorDescriptor(`message.operator_error.${code}`, { fallback });
  }

  if (statusCode === 404) {
    return errorDescriptor("message.operator_error.run_not_found", {
      fallback,
    });
  }

  if (statusCode === 403) {
    return errorDescriptor("message.operator_error.forbidden", {
      fallback,
      refreshRun: false,
    });
  }

  return errorDescriptor("message.operator_error.invalid_request", {
    fallback,
    refreshRun: false,
  });
};

const ACTION_OUTCOME_KEYS: Record<OperatorAction, TTranslationKeys> = {
  approve: "message.operator_outcome.approved",
  reject: "message.operator_outcome.rejected",
  resume: "message.operator_outcome.resumed",
  cancel: "message.operator_outcome.cancelled",
};

/**
 * Describe the run an operator request returned: the request succeeded. An
 * approve, reject or resume returns the run as soon as it is claimed
 * (`running`), and the run goes on in the background; otherwise the run may
 * have reached another wait or failed afterwards (e.g. a step with
 * `on_reject: fail`).
 *
 * @param run - Run returned by the operator endpoint.
 * @param action - Operation that was applied.
 */
export const getOperatorOutcome = (
  run: Pick<WorkflowRun, "status" | "checkpoint" | "error">,
  action: OperatorAction,
): OperatorOutcome => {
  const key = ACTION_OUTCOME_KEYS[action];

  if (action === "cancel") {
    return { key, severity: "success" };
  }

  if (run.status === EWorkflowRunStatus.FAILED) {
    return {
      key,
      severity: "warning",
      detail: {
        key: "message.operator_outcome.run_failed",
        params: { 0: run.error ?? "" },
      },
    };
  }

  if (run.status === EWorkflowRunStatus.SUSPENDED) {
    const [nextWait] = getOpenWaits(run);

    return {
      key,
      severity: "info",
      detail: nextWait
        ? {
            key: "message.operator_outcome.waiting_at",
            params: { 0: nextWait.step.name },
          }
        : { key: "message.operator_outcome.waiting" },
    };
  }

  if (run.status === EWorkflowRunStatus.FINISHED) {
    return {
      key,
      severity: "success",
      detail: { key: "message.operator_outcome.run_finished" },
    };
  }

  if (
    run.status === EWorkflowRunStatus.RUNNING ||
    run.status === EWorkflowRunStatus.IDLE
  ) {
    return {
      key,
      severity: "success",
      detail: { key: "message.operator_outcome.run_continuing" },
    };
  }

  return { key, severity: "success" };
};

/**
 * Build the debugger URL of a run.
 *
 * @returns The path, or `null` when the run has no initiator (the debugger
 * route requires one).
 */
export const getRunDebuggerPath = (
  run: Pick<WorkflowRun, "id"> & {
    workflow?: string | { id?: string } | null;
    triggeredBy?: string | { id?: string } | null;
  },
): string | null => {
  const workflowId = resolveEntityId(run.workflow);
  const initiatorId = resolveEntityId(run.triggeredBy);

  if (!workflowId || !initiatorId) {
    return null;
  }

  return `/workflow/${workflowId}/runs/${initiatorId}/${run.id}`;
};
