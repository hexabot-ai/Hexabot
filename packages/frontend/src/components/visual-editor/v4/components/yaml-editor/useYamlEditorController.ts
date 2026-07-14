/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Monaco } from "@monaco-editor/react";
import type { IDisposable, editor } from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import { isScalar, parseDocument, type YAMLMap } from "yaml";

import { useWorkflowActionsCatalog } from "@/contexts/workflow-actions.context";

import { useWorkflow } from "../../hooks/useWorkflow";

import { registerYamlCompletionProvider } from "./completion";
import {
  YAML_VALIDATION_DEBOUNCE_MS,
  YAML_WORKFLOW_VALIDATION_OWNER,
} from "./constants";
import { ensureYamlLanguageService } from "./language";
import { applyYamlMarkers } from "./markers";
import { useDebouncedEffect } from "./useDebouncedEffect";
import { applyWorkflowValidationMarkers } from "./validation/validation";

const HIGHLIGHT_CLASS = "workflow-yaml-node-def-highlight";

export function useYamlEditorController(
  onHighlightClear?: () => void,
  highlightDef?: string,
) {
  const { yaml, definitionIssues, updateDefinitionState, taskIds } =
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
  const decorationsRef = useRef<string[]>([]);
  const rangeRef = useRef<{ startLine: number; endLine: number } | null>(null);
  const onHighlightClearRef = useRef(onHighlightClear);
  const highlightDefRef = useRef(highlightDef);

  onHighlightClearRef.current = onHighlightClear;
  highlightDefRef.current = highlightDef;

  const clearHighlight = useCallback((notify = false) => {
    if (editorRef.current) {
      decorationsRef.current = editorRef.current.deltaDecorations(
        decorationsRef.current,
        [],
      );
    }
    rangeRef.current = null;
    if (notify) {
      onHighlightClearRef.current?.();
    }
  }, []);
  const setHighlight = useCallback(
    (defName: string | null) => {
      const editorInstance = editorRef.current;
      const monacoInstance = monacoRef.current;

      if (!editorInstance || !monacoInstance || !defName) {
        clearHighlight();

        return;
      }

      const model = editorInstance.getModel();

      if (!model) return;

      try {
        const doc = parseDocument(model.getValue());
        const defsMap = doc.getIn(["defs"], true) as YAMLMap | undefined;

        if (!defsMap?.items) return;

        const pair = defsMap.items.find((item) => {
          if (!item || typeof item !== "object" || !("key" in item))
            return false;

          return isScalar(item.key) && item.key.value === defName;
        }) as
          | {
              key: { range?: [number, number, number] };
              value: { range?: [number, number, number] };
            }
          | undefined;

        if (!pair?.key?.range || !pair?.value?.range) return;

        const startLine = model.getPositionAt(pair.key.range[0]).lineNumber;
        const endLine = model.getPositionAt(
          Math.max(pair.key.range[0], pair.value.range[1] - 1),
        ).lineNumber;

        rangeRef.current = { startLine, endLine };
        decorationsRef.current = editorInstance.deltaDecorations(
          decorationsRef.current,
          [
            {
              range: new monacoInstance.Range(startLine, 1, endLine, 1),
              options: {
                isWholeLine: true,
                className: HIGHLIGHT_CLASS,
                overviewRuler: {
                  color: "hsla(174,58%,38%,0.8)",
                  position: monacoInstance.editor.OverviewRulerLane.Full,
                },
              },
            },
          ],
        );
        editorInstance.revealLineInCenter(
          startLine,
          monacoInstance.editor.ScrollType.Immediate,
        );
      } catch {
        // YAML parsing failure — nothing to highlight
      }
    },
    [clearHighlight],
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
      issues: definitionIssues,
    });
  }, [yaml, definitionIssues]);
  const beforeMount = useCallback((monacoInstance: Monaco) => {
    ensureYamlLanguageService(monacoInstance);
  }, []);
  const onMount = useCallback(
    (editorInstance: editor.IStandaloneCodeEditor, monacoInstance: Monaco) => {
      editorRef.current = editorInstance;
      monacoRef.current = monacoInstance;
      applyAllMarkers();
      if (highlightDefRef.current) {
        setHighlight(highlightDefRef.current);
      }
      editorInstance.onMouseDown((e) => {
        const { startLine, endLine } = rangeRef.current ?? {};

        if (startLine === undefined || endLine === undefined) return;

        const line = e.target.position?.lineNumber;

        if (line !== undefined && line >= startLine && line <= endLine) return;

        clearHighlight(true);
      });
    },
    [applyAllMarkers, setHighlight, clearHighlight],
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

  // React to highlightDef changes after the editor is already mounted
  useEffect(() => {
    if (!editorRef.current) return;
    setHighlight(highlightDef ?? null);
  }, [highlightDef, setHighlight]);

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

  return { value: yaml, definitionIssues, onChange, beforeMount, onMount };
}
