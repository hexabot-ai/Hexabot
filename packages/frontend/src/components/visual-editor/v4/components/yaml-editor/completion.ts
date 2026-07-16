/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Monaco } from "@monaco-editor/react";
import type { IDisposable, IPosition, editor } from "monaco-editor";
import type { JSONSchema } from "monaco-yaml";

import type { IAction } from "@/types/action.types";

import {
  YAML_COMPLETION_SUGGESTIONS,
  YAML_COMPLETION_TRIGGER_CHARACTERS,
  YAML_LANGUAGE_ID,
} from "./constants";

const buildYamlCompletionItems = (monacoInstance: Monaco) =>
  YAML_COMPLETION_SUGGESTIONS.map((suggestion) => ({
    ...suggestion,
    kind: monacoInstance.languages.CompletionItemKind.Snippet,
    insertTextRules:
      monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  }));
const countIndent = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const isCommentOrBlank = (line: string) => {
  const trimmed = line.trim();

  return trimmed.length === 0 || trimmed.startsWith("#");
};
const isInDefsBlock = (model: editor.ITextModel, position: IPosition) => {
  for (let lineNumber = position.lineNumber; lineNumber >= 1; lineNumber -= 1) {
    const line = model.getLineContent(lineNumber);

    if (isCommentOrBlank(line)) continue;

    if (countIndent(line) === 0) {
      return /^defs:\s*(#.*)?$/.test(line.trim());
    }
  }

  return false;
};
const buildTaskCompletionItems = (
  monacoInstance: Monaco,
  model: editor.ITextModel,
  position: IPosition,
  taskIds?: string[],
) => {
  const linePrefix = model
    .getLineContent(position.lineNumber)
    .slice(0, position.column - 1);

  if (!/(^|\s)do:\s*[^#]*$/.test(linePrefix)) {
    return [];
  }

  if (!taskIds?.length) {
    return [];
  }

  const wordInfo = model.getWordUntilPosition(position);
  const range = {
    startLineNumber: position.lineNumber,
    startColumn: wordInfo.startColumn,
    endLineNumber: position.lineNumber,
    endColumn: wordInfo.endColumn,
  };

  return taskIds.map((taskId) => ({
    label: taskId,
    kind: monacoInstance.languages.CompletionItemKind.Reference,
    insertText: taskId,
    range,
    detail: "Workflow task",
  }));
};
const buildActionCompletionItems = (
  monacoInstance: Monaco,
  model: editor.ITextModel,
  position: IPosition,
  actions?: IAction[],
) => {
  if (!actions?.length) {
    return [];
  }

  const lineContent = model.getLineContent(position.lineNumber);

  if (lineContent.trim().startsWith("#")) {
    return [];
  }

  const linePrefix = lineContent.slice(0, position.column - 1);

  if (!/^\s*action:\s*[^#]*$/.test(linePrefix)) {
    return [];
  }

  if (!isInDefsBlock(model, position)) {
    return [];
  }

  const wordInfo = model.getWordUntilPosition(position);
  const range = {
    startLineNumber: position.lineNumber,
    startColumn: wordInfo.startColumn,
    endLineNumber: position.lineNumber,
    endColumn: wordInfo.endColumn,
  };
  const seen = new Set<string>();
  const sortedActions = actions
    .filter((action) => {
      if (!action?.name || seen.has(action.name)) {
        return false;
      }

      seen.add(action.name);

      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return sortedActions.map((action) => ({
    label: action.name,
    kind: monacoInstance.languages.CompletionItemKind.Function,
    insertText: action.name,
    range,
    detail: "Workflow action",
    documentation: action.description || undefined,
  }));
};
const INPUTS_KEY_PATTERN = /^\s*inputs:\s*(#.*)?$/;
const ACTION_KEY_PATTERN = /^\s*action:\s*(\S+)/;
const MAP_KEY_PATTERN = /^\s*([A-Za-z0-9_-]+):/;
/**
 * Walks upward from `position` to find the enclosing task's `action:` value,
 * but only when `position` sits directly inside that task's `inputs:` block.
 */
const findEnclosingInputsAction = (
  model: editor.ITextModel,
  position: IPosition,
  currentIndent: number,
): string | null => {
  let lineNum = position.lineNumber - 1;
  let inputsIndent: number | null = null;

  // 1. Walk up to find the parent 'inputs:' key
  while (lineNum >= 1) {
    const line = model.getLineContent(lineNum--);

    if (isCommentOrBlank(line)) continue;

    const indent = countIndent(line);

    if (indent < currentIndent) {
      if (INPUTS_KEY_PATTERN.test(line)) inputsIndent = indent;
      break;
    }
  }

  if (inputsIndent === null) return null;

  // 2. Walk up from the inputs key to find its sibling 'action:' key
  while (lineNum >= 1) {
    const line = model.getLineContent(lineNum--);

    if (isCommentOrBlank(line)) continue;

    const indent = countIndent(line);

    if (indent < inputsIndent) break;
    if (indent === inputsIndent) {
      const match = line.match(ACTION_KEY_PATTERN);

      if (match) return match[1];
    }
  }

  return null;
};
const collectSiblingKeys = (
  model: editor.ITextModel,
  position: IPosition,
  indent: number,
) => {
  const keys = new Set<string>();

  for (let i = 1; i <= model.getLineCount(); i++) {
    if (i === position.lineNumber) continue;
    const line = model.getLineContent(i);

    if (countIndent(line) === indent) {
      const match = line.match(MAP_KEY_PATTERN);

      if (match) keys.add(match[1]);
    }
  }

  return keys;
};
const buildInputsCompletionItems = (
  monacoInstance: Monaco,
  model: editor.ITextModel,
  position: IPosition,
  actions?: IAction[],
) => {
  if (!actions?.length) return [];

  const lineContent = model.getLineContent(position.lineNumber);
  const linePrefix = lineContent.slice(0, position.column - 1);

  // Early exit if the line is a comment or already contains a colon
  if (lineContent.trim().startsWith("#") || linePrefix.includes(":")) {
    return [];
  }

  const currentIndent = countIndent(linePrefix);
  const actionName = findEnclosingInputsAction(model, position, currentIndent);

  if (!actionName) return [];

  const action = actions.find((a) => a.name === actionName);
  const properties = (action?.inputSchema as JSONSchema | undefined)
    ?.properties;

  if (!properties) return [];

  const { startColumn, endColumn } = model.getWordUntilPosition(position);
  const range = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn,
    endColumn,
  };
  const existingKeys = collectSiblingKeys(model, position, currentIndent);

  return Object.entries(properties)
    .filter(([key, schema]) => !existingKeys.has(key) && schema !== false)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, schema]) => {
      const propSchema = typeof schema === "object" ? schema : undefined;

      return {
        label: key,
        kind: monacoInstance.languages.CompletionItemKind.Field,
        insertText: `${key}: `,
        range,
        detail: propSchema?.type ? String(propSchema.type) : "Task input",
        documentation: propSchema?.description || propSchema?.title,
      };
    });
};

export const registerYamlCompletionProvider = (
  monacoInstance: Monaco,
  getActions?: () => IAction[] | undefined,
  getTaskIds?: () => string[] | undefined,
): IDisposable => {
  const suggestions = buildYamlCompletionItems(monacoInstance);

  return monacoInstance.languages.registerCompletionItemProvider(
    YAML_LANGUAGE_ID,
    {
      triggerCharacters: [...YAML_COMPLETION_TRIGGER_CHARACTERS],
      provideCompletionItems: (model, position, context) => {
        const taskSuggestions = buildTaskCompletionItems(
          monacoInstance,
          model,
          position,
          getTaskIds?.(),
        );
        const actionSuggestions = buildActionCompletionItems(
          monacoInstance,
          model,
          position,
          getActions?.(),
        );
        const inputsSuggestions = buildInputsCompletionItems(
          monacoInstance,
          model,
          position,
          getActions?.(),
        );
        const includeBaseSuggestions = context?.triggerCharacter !== ":";

        return {
          suggestions: [
            ...(includeBaseSuggestions ? suggestions : []),
            ...taskSuggestions,
            ...actionSuggestions,
            ...inputsSuggestions,
          ],
        };
      },
    },
  );
};
