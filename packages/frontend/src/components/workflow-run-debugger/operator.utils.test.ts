/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { EWorkflowRunStatus, StepType } from "@hexabot-ai/agentic";
import type { WaitInfo } from "@hexabot-ai/agentic";
import { describe, expect, it } from "vitest";

import {
  describeOperatorWait,
  getOperatorErrorDescriptor,
  getOperatorOutcome,
  getOperatorWaits,
  getResumeFormSchema,
  getRunDebuggerPath,
  isFlatPrimitiveRecord,
  isWaitOpen,
  parseJsonObject,
  parsePayloadIssues,
} from "./operator.utils";

const buildWait = (
  stepId: string,
  reason: string,
  data?: unknown,
): WaitInfo => ({
  waitId: `${stepId}@index:0`,
  step: { id: stepId, name: stepId, type: StepType.Task },
  suspendKey: "index:0",
  reason,
  data,
});
const approval = buildWait("review", "awaiting_approval", {
  message: "Approve the refund",
  details: { amount: 42 },
});
const resume = buildWait("collect", "awaiting_resume", {
  message: "Supply the reference",
  details: null,
  payload_schema: {
    type: "object",
    properties: { reference: { type: "string", minLength: 3 } },
    required: ["reference"],
  },
});
const reply = buildWait("ask", "awaiting_user_response");
const suspendedRun = (waits: WaitInfo[]) => ({
  status: EWorkflowRunStatus.SUSPENDED,
  checkpoint: { version: 1, waits },
});

describe("operator utils", () => {
  describe("getOperatorWaits", () => {
    it("keeps the approval and resume waits of a suspended run", () => {
      expect(getOperatorWaits(suspendedRun([reply, approval, resume]))).toEqual(
        [approval, resume],
      );
    });

    it("ignores a run that is not suspended", () => {
      expect(
        getOperatorWaits({
          status: EWorkflowRunStatus.RUNNING,
          checkpoint: { waits: [approval] },
        }),
      ).toEqual([]);
    });
  });

  describe("isWaitOpen", () => {
    it("tells whether the wait is still open", () => {
      const run = suspendedRun([approval]);

      expect(isWaitOpen(run, approval.waitId)).toBe(true);
      expect(isWaitOpen(run, resume.waitId)).toBe(false);
      expect(
        isWaitOpen(
          { status: EWorkflowRunStatus.FINISHED, checkpoint: null },
          approval.waitId,
        ),
      ).toBe(false);
    });
  });

  describe("describeOperatorWait", () => {
    it("describes an approval wait", () => {
      expect(describeOperatorWait(approval)).toEqual({
        kind: "approval",
        message: "Approve the refund",
        details: { amount: 42 },
        payloadSchema: null,
      });
    });

    it("describes a resume wait with its payload schema", () => {
      expect(describeOperatorWait(resume)).toEqual({
        kind: "resume",
        message: "Supply the reference",
        details: null,
        payloadSchema: (resume.data as { payload_schema: unknown })
          .payload_schema,
      });
    });

    it("tolerates malformed data", () => {
      expect(
        describeOperatorWait(buildWait("x", "awaiting_approval", "oops")),
      ).toEqual({
        kind: "approval",
        message: null,
        details: null,
        payloadSchema: null,
      });
    });

    it("ignores waits an admin does not resolve", () => {
      expect(describeOperatorWait(reply)).toBeNull();
    });
  });

  describe("getResumeFormSchema", () => {
    it("keeps an object schema with properties", () => {
      const schema = { type: "object", properties: { a: { type: "string" } } };

      expect(getResumeFormSchema(schema)).toBe(schema);
    });

    it.each([
      ["no schema", null],
      ["a non-object root", { type: "string" }],
      ["an object without properties", { type: "object" }],
      [
        "a schema zod cannot read",
        {
          type: "object",
          properties: { a: { type: "string" } },
          if: { properties: { a: { const: "x" } } },
          then: { required: ["a"] },
        },
      ],
    ])("falls back to the JSON editor for %s", (_label, schema) => {
      expect(getResumeFormSchema(schema)).toBeNull();
    });
  });

  describe("parseJsonObject", () => {
    it("parses an object", () => {
      expect(parseJsonObject('{"a": 1}')).toEqual({
        ok: true,
        value: { a: 1 },
      });
    });

    it.each([
      ["[1]", "not_object"],
      ["42", "not_object"],
      ["null", "not_object"],
      ["{", "invalid"],
    ])("refuses %s", (text, reason) => {
      expect(parseJsonObject(text)).toEqual({ ok: false, reason });
    });
  });

  describe("isFlatPrimitiveRecord", () => {
    it("accepts scalars only", () => {
      expect(isFlatPrimitiveRecord({ a: 1, b: "x", c: null, d: true })).toBe(
        true,
      );
      expect(isFlatPrimitiveRecord({ a: { b: 1 } })).toBe(false);
      expect(isFlatPrimitiveRecord({ a: [1] })).toBe(false);
      expect(isFlatPrimitiveRecord(null)).toBe(false);
    });
  });

  describe("parsePayloadIssues", () => {
    it("strips the data prefix of each path", () => {
      expect(
        parsePayloadIssues([
          "data.reference: Too small",
          "data.items.0.id: Required",
          "data: Invalid input",
          "(root): Expected object",
          "decision: Invalid option",
          "no separator",
          42,
        ]),
      ).toEqual([
        { path: "reference", message: "Too small" },
        { path: "items.0.id", message: "Required" },
        { path: "", message: "Invalid input" },
        { path: "", message: "Expected object" },
        { path: "decision", message: "Invalid option" },
        { path: "", message: "no separator" },
      ]);
    });

    it("ignores a missing list", () => {
      expect(parsePayloadIssues(undefined)).toEqual([]);
    });
  });

  describe("getOperatorErrorDescriptor", () => {
    it.each([
      "wait_ambiguous",
      "wait_kind_mismatch",
      "run_not_suspended",
      "wait_not_found",
      "no_matching_wait",
      "claim_lost",
      "unresumable",
      "resume_unavailable",
    ])("maps %s and reloads the run", (code) => {
      expect(
        getOperatorErrorDescriptor({
          statusCode: 409,
          code,
          message: "Server says no",
        }),
      ).toMatchObject({
        key: `message.operator_error.${code}`,
        fallback: "Server says no",
        severity: "error",
        refreshRun: true,
        inline: false,
        silent: false,
      });
    });

    it.each([
      "initiator_unavailable",
      "thread_unavailable",
      "thread_closed",
      "channel_unavailable",
      "source_disabled",
      "unsupported_trigger",
    ])("maps trigger_unavailable (%s)", (reason) => {
      expect(
        getOperatorErrorDescriptor({
          statusCode: 409,
          code: "trigger_unavailable",
          reason,
        }).key,
      ).toBe(`message.operator_error.trigger_unavailable.${reason}`);
    });

    it("maps an unknown trigger_unavailable reason", () => {
      expect(
        getOperatorErrorDescriptor({
          statusCode: 409,
          code: "trigger_unavailable",
          reason: "new_reason",
        }).key,
      ).toBe("message.operator_error.trigger_unavailable.unknown");
    });

    it("keeps a refused payload inside the dialog", () => {
      expect(
        getOperatorErrorDescriptor({
          statusCode: 422,
          code: "payload_rejected",
          message: "Resume payload was rejected",
          issues: ["data.reference: Too small"],
        }),
      ).toMatchObject({
        key: "message.operator_error.payload_rejected",
        refreshRun: false,
        inline: true,
        issues: [{ path: "reference", message: "Too small" }],
      });
    });

    it("maps a missing run", () => {
      expect(
        getOperatorErrorDescriptor({
          statusCode: 404,
          message: "WorkflowRun with ID x not found",
          error: "Not Found",
        }),
      ).toMatchObject({
        key: "message.operator_error.run_not_found",
        refreshRun: true,
      });
    });

    it("maps a forbidden request", () => {
      expect(
        getOperatorErrorDescriptor({ statusCode: 403, message: "Forbidden" }),
      ).toMatchObject({
        key: "message.operator_error.forbidden",
        refreshRun: false,
      });
    });

    it("joins class-validator messages", () => {
      expect(
        getOperatorErrorDescriptor({
          statusCode: 400,
          message: ["comment must be shorter", "waitId must be a string"],
          error: "Bad Request",
        }),
      ).toMatchObject({
        key: "message.operator_error.invalid_request",
        fallback: "comment must be shorter, waitId must be a string",
        refreshRun: false,
      });
    });

    it.each([
      ["a gateway timeout page", "<html>504 Gateway Time-out</html>"],
      ["a server error", { statusCode: 500, message: "Internal error" }],
    ])("reports an unknown outcome for %s", (_label, error) => {
      expect(getOperatorErrorDescriptor(error)).toMatchObject({
        key: "message.operator_error.unknown_outcome",
        severity: "warning",
        refreshRun: true,
        silent: false,
      });
    });

    it("stays silent on network errors, which are already reported", () => {
      expect(
        getOperatorErrorDescriptor(new Error("Network error")),
      ).toMatchObject({
        key: "message.operator_error.unknown_outcome",
        refreshRun: true,
        silent: true,
      });
    });
  });

  describe("getOperatorOutcome", () => {
    it("reports a finished run", () => {
      expect(
        getOperatorOutcome(
          {
            status: EWorkflowRunStatus.FINISHED,
            checkpoint: null,
            error: null,
          },
          "approve",
        ),
      ).toEqual({
        key: "message.operator_outcome.approved",
        severity: "success",
        detail: { key: "message.operator_outcome.run_finished" },
      });
    });

    it("reports a run that goes on in the background", () => {
      expect(
        getOperatorOutcome(
          {
            status: EWorkflowRunStatus.RUNNING,
            checkpoint: null,
            error: null,
          },
          "approve",
        ),
      ).toEqual({
        key: "message.operator_outcome.approved",
        severity: "success",
        detail: { key: "message.operator_outcome.run_continuing" },
      });
    });

    it("reports the next wait of a run suspended again", () => {
      expect(
        getOperatorOutcome(
          { ...suspendedRun([approval]), error: null },
          "resume",
        ),
      ).toEqual({
        key: "message.operator_outcome.resumed",
        severity: "info",
        detail: {
          key: "message.operator_outcome.waiting_at",
          params: { 0: "review" },
        },
      });
    });

    it("warns when the run failed after the decision", () => {
      expect(
        getOperatorOutcome(
          {
            status: EWorkflowRunStatus.FAILED,
            checkpoint: null,
            error: "Rejected by Jane Doe",
          },
          "reject",
        ),
      ).toEqual({
        key: "message.operator_outcome.rejected",
        severity: "warning",
        detail: {
          key: "message.operator_outcome.run_failed",
          params: { 0: "Rejected by Jane Doe" },
        },
      });
    });

    it("reports a cancellation as a success", () => {
      expect(
        getOperatorOutcome(
          {
            status: EWorkflowRunStatus.FAILED,
            checkpoint: null,
            error: "Cancelled by Jane Doe",
          },
          "cancel",
        ),
      ).toEqual({
        key: "message.operator_outcome.cancelled",
        severity: "success",
      });
    });
  });

  describe("getRunDebuggerPath", () => {
    it("builds the path from ids or populated relations", () => {
      expect(
        getRunDebuggerPath({
          id: "run-1",
          workflow: { id: "flow-1" },
          triggeredBy: "user-1",
        }),
      ).toBe("/workflow/flow-1/runs/user-1/run-1");
    });

    it("returns null without an initiator", () => {
      expect(
        getRunDebuggerPath({
          id: "run-1",
          workflow: "flow-1",
          triggeredBy: null,
        }),
      ).toBeNull();
    });
  });
});
