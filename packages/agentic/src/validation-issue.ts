/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

export type WorkflowValidationIssueCode =
  | 'yaml_parse'
  | 'schema'
  | 'unknown_task'
  | 'missing_action'
  | 'binding_registry_required'
  | 'unknown_binding_kind'
  | 'action_required'
  | 'action_forbidden'
  | 'binding_settings'
  | 'binding_ref'
  | 'binding_unsupported'
  | 'binding_cycle';

export type WorkflowValidationIssue = {
  code: WorkflowValidationIssueCode;
  /** Human-readable message; kept identical to the legacy error strings. */
  message: string;
  /** Path within the YAML document, e.g. ["defs", "my_task", "action"]. */
  path?: Array<string | number>;
  /** Referenced action name, set for `missing_action` issues. */
  actionName?: string;
  /** Referenced task id, set for `unknown_task` issues. */
  taskId?: string;
  /** Binding kind involved, set for binding-related issues where known. */
  bindingKind?: string;
};

export const issueMessages = (issues: WorkflowValidationIssue[]): string[] =>
  issues.map((issue) => issue.message);
