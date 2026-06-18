/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Monaco } from "@monaco-editor/react";
import type { IDisposable, editor } from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";

import { useWorkflowActionsCatalog } from "@/contexts/workflow-actions.context";

import { useWorkflow } from "../../hooks/useWorkflow";
import { useYamlHighlight } from "../../hooks/useYamlHighlight";

import { registerYamlCompletionProvider } from "./completion";
import {
  YAML_VALIDATION_DEBOUNCE_MS,
  YAML_WORKFLOW_VALIDATION_OWNER,
} from "./constants";
import { ensureYamlLanguageService } from "./language";
import { applyYamlMarkers } from "./markers";
import { useDebouncedEffect } from "./useDebouncedEffect";
import { applyWorkflowValidationMarkers } from "./validation/validation";

export function useYamlEditorController(
  onHighlightClear?: () => void,
  highlightDef?: string,
) {
  const { yaml, definitionErrors, updateDefinitionState, taskIds } =
    useWorkflow();
  const {
    actions = [],
    isLoading: actionsLoading,
    isError: actionsError,
  } = useWorkflowActionsCatalog();
  const availableActions = actionsLoading || actionsError ? undefined : actions;
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const completionDisposableRef = useRef<IDisposable | null>(null);
  const { setupHighlightOnMount } = useYamlHighlight(
    editorRef,
    monacoRef,
    highlightDef,
    onHighlightClear,
  );
  const onChange = useCallback(
    (nextValue?: string) => {
      updateDefinitionState(nextValue || "", { persist: "debounced" });
    },
    [updateDefinitionState],
  );
  const applyAllMarkers = useCallback(() => {
    applyYamlMarkers({
      editorInstance: editorRef.current,
      monacoInstance: monacoRef.current,
    });
    applyWorkflowValidationMarkers({
      editorInstance: editorRef.current,
      monacoInstance: monacoRef.current,
      yaml,
      actions: availableActions,
    });
  }, [yaml, availableActions]);
  const beforeMount = useCallback((monacoInstance: Monaco) => {
    ensureYamlLanguageService(monacoInstance);
  }, []);
  const onMount = useCallback(
    (editorInstance: editor.IStandaloneCodeEditor, monacoInstance: Monaco) => {
      editorRef.current = editorInstance;
      monacoRef.current = monacoInstance;
      applyAllMarkers();
      setupHighlightOnMount(editorInstance);
    },
    [applyAllMarkers, setupHighlightOnMount],
  );

  useEffect(() => {
    applyAllMarkers();
  }, [applyAllMarkers]);

  useDebouncedEffect(
    () => {
      if (!editorRef.current || !monacoRef.current) return;

      applyAllMarkers();
    },
    [applyAllMarkers],
    YAML_VALIDATION_DEBOUNCE_MS,
  );

  useEffect(() => {
    const monaco = monacoRef.current;

    if (!monaco) return;

    completionDisposableRef.current?.dispose();
    completionDisposableRef.current = registerYamlCompletionProvider(
      monaco,
      () => availableActions,
      () => taskIds,
    );

    return () => {
      completionDisposableRef.current?.dispose();
      completionDisposableRef.current = null;
    };
  }, [availableActions, taskIds]);

  useEffect(() => {
    return () => {
      if (!editorRef.current || !monacoRef.current) return;

      const model = editorRef.current.getModel();

      if (!model) return;

      monacoRef.current.editor.setModelMarkers(
        model,
        YAML_WORKFLOW_VALIDATION_OWNER,
        [],
      );
    };
  }, []);

  return { value: yaml, definitionErrors, onChange, beforeMount, onMount };
}
