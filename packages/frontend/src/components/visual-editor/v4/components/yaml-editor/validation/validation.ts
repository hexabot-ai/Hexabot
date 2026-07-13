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

import { YAML_WORKFLOW_VALIDATION_OWNER } from "../constants";

import { getRangeForPath, type ReferencePath } from "./validation.paths";
import { appendSchemaMarkers, isSchemaLike } from "./validation.schema";
import { collectTaskReferences } from "./validation.tasks";

type ApplyWorkflowValidationMarkersOptions = {
  editorInstance: editor.IStandaloneCodeEditor | null;
  monacoInstance: Monaco | null;
  yaml: string;
  actions?: IAction[];
};
type WorkflowValidationIssueCounts = {
  warnings: number;
  errors: number;
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

export const getWorkflowValidationIssueCounts = ({
  yaml,
  actions,
}: Pick<
  ApplyWorkflowValidationMarkersOptions,
  "yaml" | "actions"
>): WorkflowValidationIssueCounts => {
  if (!yaml) {
    return { warnings: 0, errors: 0 };
  }

  const doc = parseDocument(yaml);

  if (doc.errors.length > 0) {
    return {
      warnings: doc.warnings.length,
      errors: doc.errors.length,
    };
  }

  const markers = collectWorkflowValidationMarkers({
    monacoInstance: {
      MarkerSeverity: { Error: 8 },
    } as unknown as Monaco,
    yaml,
    actions,
  });

  return {
    warnings: doc.warnings.length,
    errors: markers.length,
  };
};

const collectWorkflowValidationMarkers = ({
  monacoInstance,
  yaml,
  actions,
}: Pick<
  ApplyWorkflowValidationMarkersOptions,
  "monacoInstance" | "yaml" | "actions"
>) => {
  if (!monacoInstance) return [];
  // Build a YAML AST so validation errors can be mapped to source locations.
  const lineCounter = new LineCounter();
  const doc = parseDocument(yaml, { lineCounter });

  if (doc.errors.length > 0) {
    // YAML syntax issues are surfaced elsewhere.
    return [];
  }

  const markers: editor.IMarkerData[] = [];
  const parsed = WorkflowDefinitionSchema.safeParse(doc.toJS());

  if (!parsed.success) {
    // Only surface JSONata expression errors from the workflow schema.
    parsed.error.issues.forEach((issue) => {
      if (
        issue.code !== "custom" ||
        !issue.message.startsWith("Invalid JSONata expression")
      ) {
        return;
      }

      markers.push({
        ...getRangeForPath(doc, toReferencePath(issue.path), lineCounter),
        message: issue.message,
        severity: monacoInstance.MarkerSeverity.Error,
      });
    });

    return markers;
  }

  const taskDefinitions = extractTaskDefinitions(parsed.data.defs);
  const knownTasks = new Set(Object.keys(taskDefinitions));
  const references = collectTaskReferences(parsed.data.flow, ["flow"]);
  const actionsByName =
    actions?.reduce<Record<string, IAction>>((acc, action) => {
      acc[action.name] = action;

      return acc;
    }, {}) ?? null;

  // Flag workflow references to tasks that are not defined.
  references.forEach((reference) => {
    if (knownTasks.has(reference.taskId)) return;

    markers.push({
      ...getRangeForPath(doc, reference.path, lineCounter),
      message: `Unknown task referenced: "${reference.taskId}"`,
      severity: monacoInstance.MarkerSeverity.Error,
    });
  });

  if (actionsByName) {
    // Validate task inputs/settings/outputs against action schemas.
    Object.entries(taskDefinitions).forEach(([taskName, task]) => {
      const actionName = task.action;
      const actionDefinition = actionsByName[actionName];
      const taskPath: ReferencePath = ["defs", taskName];

      if (!actionDefinition) {
        markers.push({
          ...getRangeForPath(doc, [...taskPath, "action"], lineCounter),
          message: `Unknown action: "${actionName}"`,
          severity: monacoInstance.MarkerSeverity.Error,
        });

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

  return markers;
};

export const applyWorkflowValidationMarkers = ({
  editorInstance,
  monacoInstance,
  yaml,
  actions,
}: ApplyWorkflowValidationMarkersOptions) => {
  if (!editorInstance || !monacoInstance) return;
  const model = editorInstance.getModel();

  if (!model) return;

  monacoInstance.editor.setModelMarkers(
    model,
    YAML_WORKFLOW_VALIDATION_OWNER,
    collectWorkflowValidationMarkers({
      monacoInstance,
      yaml,
      actions,
    }),
  );
};
