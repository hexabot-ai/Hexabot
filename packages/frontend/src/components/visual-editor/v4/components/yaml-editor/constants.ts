/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { editor } from "monaco-editor";

export const YAML_VALIDATION_OWNER = "yaml-validation";
export const YAML_WORKFLOW_VALIDATION_OWNER = "yaml-workflow-validation";
export const YAML_VALIDATION_DEBOUNCE_MS = 300;

export const YAML_EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions =
  {
    fontSize: 14,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    smoothScrolling: true,
    wordWrap: "on",
    tabSize: 2,
    insertSpaces: true,
    renderLineHighlight: "line",
    quickSuggestions: true,
    suggestOnTriggerCharacters: true,
    suggest: { showClasses: false },
    fixedOverflowWidgets: true,
  };
