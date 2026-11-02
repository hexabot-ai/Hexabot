/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import Editor from "@monaco-editor/react";
import { useColorScheme } from "@mui/material";

import { handleEditorWillMount } from "./JsonataFormulaField/monaco";

export type JsonEditorProps = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
};

const JSON_EDITOR_OPTIONS = {
  automaticLayout: true,
  minimap: { enabled: false },
  scrollbar: {
    handleMouseWheel: true,
    alwaysConsumeMouseWheel: false,
  },
  scrollBeyondLastLine: false,
  wordWrap: "on" as const,
  lineNumbers: "on" as const,
  folding: true,
  tabSize: 2,
  formatOnPaste: true,
  glyphMargin: false,
  lineDecorationsWidth: 8,
  lineNumbersMinChars: 3,
};

/**
 * Editable JSON text, sized by its parent (give it a fixed height).
 */
export function JsonEditor({ value, onChange, readOnly }: JsonEditorProps) {
  const { mode } = useColorScheme();

  return (
    <Editor
      value={value}
      defaultLanguage="json"
      theme={mode}
      height="100%"
      width="100%"
      options={{ ...JSON_EDITOR_OPTIONS, readOnly, domReadOnly: readOnly }}
      beforeMount={handleEditorWillMount}
      onChange={(next) => onChange(next ?? "")}
    />
  );
}
