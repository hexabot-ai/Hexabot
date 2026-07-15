/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import Editor, { Monaco } from "@monaco-editor/react";
import { useColorScheme } from "@mui/material";

import { handleEditorWillMount } from "@/app-components/inputs/JsonataFormulaField/monaco";

import { YAML_EDITOR_OPTIONS } from "./constants";
import {
  useYamlEditorController,
  type YamlEditorRevealTarget,
} from "./useYamlEditorController";

import "./yaml.worker";

type YamlEditorProps = {
  onHighlightClear?: () => void;
  highlightDef?: string;
  revealTarget?: YamlEditorRevealTarget;
};

export function YamlEditor({
  onHighlightClear,
  highlightDef,
  revealTarget,
}: YamlEditorProps) {
  const { value, onChange, beforeMount, onMount } = useYamlEditorController(
    onHighlightClear,
    highlightDef,
    revealTarget,
  );
  const { mode } = useColorScheme();

  return (
    <div className="yaml-editor nokey">
      <div className="yaml-editor__body">
        <Editor
          value={value}
          onChange={onChange}
          defaultLanguage="yaml"
          beforeMount={(monaco: Monaco) => {
            beforeMount(monaco);
            handleEditorWillMount(monaco);
          }}
          theme={mode}
          height="100%"
          width="100%"
          onMount={onMount}
          options={YAML_EDITOR_OPTIONS}
        />
      </div>
    </div>
  );
}
