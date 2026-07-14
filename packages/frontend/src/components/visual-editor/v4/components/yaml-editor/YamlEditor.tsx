/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import Editor, { Monaco } from "@monaco-editor/react";
import { Alert, AlertTitle, useColorScheme } from "@mui/material";

import { handleEditorWillMount } from "@/app-components/inputs/JsonataFormulaField/monaco";
import { useTranslate } from "@/hooks/useTranslate";

import { uniqueIssueMessages } from "../../utils/workflow-issue-localization";

import { YAML_EDITOR_OPTIONS } from "./constants";
import { useYamlEditorController } from "./useYamlEditorController";

import "./yaml.worker";

type YamlEditorProps = {
  onHighlightClear?: () => void;
  highlightDef?: string;
};

export function YamlEditor({
  onHighlightClear,
  highlightDef,
}: YamlEditorProps) {
  const { value, definitionIssues, onChange, beforeMount, onMount } =
    useYamlEditorController(onHighlightClear, highlightDef);
  const { mode } = useColorScheme();
  const { t } = useTranslate();
  const issueMessages = uniqueIssueMessages(definitionIssues);

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
      {issueMessages.length > 0 ? (
        <Alert severity="error" className="yaml-editor__alert">
          <AlertTitle>
            {t("visual_editor.yaml_editor.validation_title")}
          </AlertTitle>
          <ul className="yaml-editor__error-list">
            {issueMessages.map((issueMessage) => (
              <li key={issueMessage}>{issueMessage}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}
