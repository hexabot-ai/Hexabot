/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  BaseSettingsSchema,
  WorkflowDefinitionSchema,
  extractTaskDefinitions,
} from "@hexabot-ai/agentic";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { LineCounter, parseDocument } from "yaml";

import type { IAction } from "@/types/action.types";

import type { WorkflowIssue } from "../../../types/workflow.types";
import { YAML_WORKFLOW_VALIDATION_OWNER } from "../constants";

import { getRangeForPath, type ReferencePath } from "./validation.paths";
import { appendSchemaMarkers, isSchemaLike } from "./validation.schema";

type ApplyWorkflowValidationMarkersOptions = {
  editorInstance: editor.IStandaloneCodeEditor | null;
  monacoInstance: Monaco | null;
  yaml: string;
  actions?: IAction[];
  /** Centralized validation issues; each issue with a path becomes a marker. */
  issues?: WorkflowIssue[];
};

const EXECUTION_SETTING_KEYS = new Set(Object.keys(BaseSettingsSchema.shape));
const EXECUTION_SETTINGS_SCHEMA = BaseSettingsSchema.toJSONSchema({
  target: "draft-07",
});
const splitTaskSettings = (settings: unknown) => {
  const actionSettings: Record<string, unknown> = {};
  const executionSettings: Record<string, unknown> = {};

  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { actionSettings, executionSettings };
  }

  for (const [key, value] of Object.entries(settings)) {
    if (EXECUTION_SETTING_KEYS.has(key)) {
      executionSettings[key] = value;
      continue;
    }

    actionSettings[key] = value;
  }

  return { actionSettings, executionSettings };
};
// YAML paths only support string/number keys, so drop symbol segments.
const toReferencePath = (path: readonly PropertyKey[]): ReferencePath =>
  path.filter(
    (segment): segment is string | number =>
      typeof segment === "string" || typeof segment === "number",
  );
// Zod "schema" issues other than JSONata expression errors are already
// underlined by monaco-yaml's own JSON-schema validation; re-marking them
// would double-report. Every other issue code adds signal.
const shouldMarkIssue = (issue: WorkflowIssue): boolean =>
  Boolean(issue.path) &&
  (issue.code !== "schema" ||
    issue.rawMessage.includes("Invalid JSONata expression"));

export const applyWorkflowValidationMarkers = ({
  editorInstance,
  monacoInstance,
  yaml,
  actions,
  issues = [],
}: ApplyWorkflowValidationMarkersOptions) => {
  if (!editorInstance || !monacoInstance) return;
  const model = editorInstance.getModel();

  if (!model) return;

  // Build a YAML AST so validation errors can be mapped to source locations.
  const lineCounter = new LineCounter();
  const doc = parseDocument(yaml, { lineCounter });

  if (doc.errors.length > 0) {
    // YAML syntax issues are surfaced elsewhere, so clear workflow markers here.
    monacoInstance.editor.setModelMarkers(
      model,
      YAML_WORKFLOW_VALIDATION_OWNER,
      [],
    );

    return;
  }

  const markers: editor.IMarkerData[] = [];

  // Centralized validation issues (missing actions, unknown tasks, binding
  // problems, JSONata errors, …) mapped to their source locations.
  issues.forEach((issue) => {
    if (!shouldMarkIssue(issue) || !issue.path) return;

    markers.push({
      ...getRangeForPath(doc, toReferencePath(issue.path), lineCounter),
      message: issue.message,
      severity: monacoInstance.MarkerSeverity.Error,
    });
  });

  const parsed = WorkflowDefinitionSchema.safeParse(doc.toJS());

  if (!parsed.success) {
    monacoInstance.editor.setModelMarkers(
      model,
      YAML_WORKFLOW_VALIDATION_OWNER,
      markers,
    );

    return;
  }

  const taskDefinitions = extractTaskDefinitions(parsed.data.defs);
  const actionsByName =
    actions?.reduce<Record<string, IAction>>((acc, action) => {
      acc[action.name] = action;

      return acc;
    }, {}) ?? null;

  if (actionsByName) {
    // Validate task inputs/settings/outputs against action schemas — the
    // centralized validator has no knowledge of per-action JSON schemas.
    Object.entries(taskDefinitions).forEach(([taskName, task]) => {
      const actionName = task.action;
      const actionDefinition = actionsByName[actionName];
      const taskPath: ReferencePath = ["defs", taskName];

      if (!actionDefinition) {
        // Missing action is already marked via the centralized issues; there
        // are no schemas to validate against.
        return;
      }

      const inputSchema = actionDefinition.inputSchema;
      const settingSchema = actionDefinition.settingSchema;
      const { actionSettings, executionSettings } = splitTaskSettings(
        task.settings,
      );

      if (isSchemaLike(inputSchema)) {
        appendSchemaMarkers({
          section: "inputs",
          schema: inputSchema,
          instance: task.inputs ?? {},
          basePath: [...taskPath, "inputs"],
          doc,
          lineCounter,
          markers,
          monacoInstance,
        });
      }

      if (task.settings !== undefined && isSchemaLike(settingSchema)) {
        appendSchemaMarkers({
          section: "settings",
          schema: settingSchema,
          instance: actionSettings,
          basePath: [...taskPath, "settings"],
          doc,
          lineCounter,
          markers,
          monacoInstance,
        });
      }

      if (
        task.settings !== undefined &&
        Object.keys(executionSettings).length > 0 &&
        isSchemaLike(EXECUTION_SETTINGS_SCHEMA)
      ) {
        appendSchemaMarkers({
          section: "settings",
          schema: EXECUTION_SETTINGS_SCHEMA,
          instance: executionSettings,
          basePath: [...taskPath, "settings"],
          doc,
          lineCounter,
          markers,
          monacoInstance,
        });
      }
    });
  }

  monacoInstance.editor.setModelMarkers(
    model,
    YAML_WORKFLOW_VALIDATION_OWNER,
    markers,
  );
};
