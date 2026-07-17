/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import { isScalar, parseDocument, type YAMLMap } from "yaml";

import { useWorkflowActionsCatalog } from "@/contexts/workflow-actions.context";
import { useWorkflowBindingsCatalog } from "@/contexts/workflow-bindings.context";

import { useWorkflow } from "../../hooks/useWorkflow";
import { extractDefsFromYaml } from "../../utils/workflow-definition.utils";

import { buildWorkflowYamlSchema } from "./completion";
import {
  YAML_VALIDATION_DEBOUNCE_MS,
  YAML_WORKFLOW_VALIDATION_OWNER,
} from "./constants";
import { ensureYamlLanguageService } from "./language";
import { applyYamlMarkers } from "./markers";
import { useDebouncedEffect } from "./useDebouncedEffect";
import { applyWorkflowValidationMarkers } from "./validation/validation";

const HIGHLIGHT_CLASS = "workflow-yaml-node-def-highlight";

/**
 * Request to reveal a specific line in the editor. `nonce` changes on every
 * request so repeat clicks on the same line re-trigger the reveal; `line` is
 * a 1-based line number (undefined = just open, no reveal).
 */
export type YamlEditorRevealTarget = {
  nonce: number;
  line?: number;
};

export function useYamlEditorController(
  onHighlightClear?: () => void,
  highlightDef?: string,
  revealTarget?: YamlEditorRevealTarget,
) {
  const { yaml, definitionIssues, updateDefinitionState } = useWorkflow();
  const { actions = [] } = useWorkflowActionsCatalog();
  const { bindings } = useWorkflowBindingsCatalog();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const rangeRef = useRef<{ startLine: number; endLine: number } | null>(null);
  const onHighlightClearRef = useRef(onHighlightClear);
  const highlightDefRef = useRef(highlightDef);
  const revealTargetRef = useRef(revealTarget);
  // Nonce of the reveal request already applied, so each request reveals once.
  const appliedRevealNonceRef = useRef<number | undefined>(undefined);

  onHighlightClearRef.current = onHighlightClear;
  highlightDefRef.current = highlightDef;
  revealTargetRef.current = revealTarget;

  const revealLine = useCallback((line: number) => {
    const editorInstance = editorRef.current;
    const monacoInstance = monacoRef.current;

    if (!editorInstance || !monacoInstance) return;

    const model = editorInstance.getModel();

    if (!model) return;

    const clamped = Math.min(Math.max(line, 1), model.getLineCount());

    editorInstance.revealLineInCenter(
      clamped,
      monacoInstance.editor.ScrollType.Immediate,
    );
    editorInstance.setPosition({ lineNumber: clamped, column: 1 });
    editorInstance.focus();
  }, []);
  const applyPendingReveal = useCallback(() => {
    const target = revealTargetRef.current;

    if (!target || target.line === undefined) return;
    if (appliedRevealNonceRef.current === target.nonce) return;

    appliedRevealNonceRef.current = target.nonce;
    revealLine(target.line);
  }, [revealLine]);
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
  const beforeMount = useCallback(
    (monacoInstance: Monaco) => {
      ensureYamlLanguageService(
        monacoInstance,
        buildWorkflowYamlSchema(actions, bindings, extractDefsFromYaml(yaml)),
      );
    },
    [actions, bindings, yaml],
  );
  const onMount = useCallback(
    (editorInstance: editor.IStandaloneCodeEditor, monacoInstance: Monaco) => {
      editorRef.current = editorInstance;
      monacoRef.current = monacoInstance;
      applyAllMarkers();
      if (highlightDefRef.current) {
        setHighlight(highlightDefRef.current);
      }
      // Apply a reveal request queued while the editor was still unmounted
      // (e.g. the drawer just opened from a graph error line click).
      applyPendingReveal();
      editorInstance.onMouseDown((e) => {
        const { startLine, endLine } = rangeRef.current ?? {};

        if (startLine === undefined || endLine === undefined) return;

        const line = e.target.position?.lineNumber;

        if (line !== undefined && line >= startLine && line <= endLine) return;

        clearHighlight(true);
      });
    },
    [applyAllMarkers, applyPendingReveal, setHighlight, clearHighlight],
  );

  useEffect(() => {
    applyAllMarkers();
  }, [applyAllMarkers]);

  // Reveal a newly requested line once the editor is already mounted.
  useEffect(() => {
    if (!editorRef.current) return;

    applyPendingReveal();
  }, [revealTarget?.nonce, applyPendingReveal]);

  useDebouncedEffect(
    () => {
      if (!editorRef.current || !monacoRef.current) return;

      applyAllMarkers();
    },
    [applyAllMarkers],
    YAML_VALIDATION_DEBOUNCE_MS,
  );

  useEffect(() => {
    if (!monacoRef.current) return;

    beforeMount(monacoRef.current);
  }, [beforeMount]);

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

  return { value: yaml, onChange, beforeMount, onMount };
}
