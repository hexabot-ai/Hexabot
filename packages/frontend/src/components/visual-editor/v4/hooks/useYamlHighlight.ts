/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { LineCounter, parseDocument, type YAMLMap } from "yaml";

const HIGHLIGHT_CLASS = "workflow-yaml-node-def-highlight";

export function useYamlHighlight(
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>,
  monacoRef: MutableRefObject<Monaco | null>,
  highlightDef?: string,
  onHighlightClear?: () => void,
) {
  const defHighlightDecorationsRef = useRef<string[]>([]);
  const activeHighlightDefRef = useRef<string | null>(null);
  const highlightRangeRef = useRef<{
    startLine: number;
    endLine: number;
  } | null>(null);
  const onHighlightClearRef = useRef(onHighlightClear);
  const highlightDefRef = useRef(highlightDef);

  onHighlightClearRef.current = onHighlightClear;
  highlightDefRef.current = highlightDef;

  const revealNodeDef = useCallback((defName: string) => {
    const editorInstance = editorRef.current;
    const monacoInstance = monacoRef.current;

    if (!editorInstance || !monacoInstance) return;

    const model = editorInstance.getModel();

    if (!model) return;

    try {
      const lineCounter = new LineCounter();
      const doc = parseDocument(model.getValue(), { lineCounter });
      const defsMap = doc.getIn(["defs"], true) as YAMLMap | undefined;

      if (!defsMap || !("items" in defsMap)) return;

      const pair = defsMap.items.find(
        (item) =>
          item &&
          typeof item === "object" &&
          "key" in item &&
          item.key !== null &&
          typeof item.key === "object" &&
          "value" in item.key &&
          (item.key as { value: unknown }).value === defName,
      ) as
        | {
            key: { range?: [number, number, number] };
            value: { range?: [number, number, number] };
          }
        | undefined;

      if (!pair?.key?.range || !pair?.value?.range) return;

      const keyOffset = pair.key.range[0];
      const valueContentEnd = pair.value.range[1];
      const startLine = lineCounter.linePos(keyOffset).line;
      const endOffset =
        valueContentEnd > keyOffset ? valueContentEnd - 1 : keyOffset;
      const endLine = lineCounter.linePos(endOffset).line;

      activeHighlightDefRef.current = defName;
      highlightRangeRef.current = { startLine, endLine };
      defHighlightDecorationsRef.current = editorInstance.deltaDecorations(
        defHighlightDecorationsRef.current,
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
      // ScrollType.Immediate (1) sets scroll synchronously — prevents Monaco's
      // own initial-render requestAnimationFrame from resetting it to position 0.
      editorInstance.revealLinesInCenter(startLine, endLine, 1);
    } catch {
      // If YAML parsing fails, do nothing
    }
  }, []);
  const clearNodeDefHighlight = useCallback(() => {
    const editorInstance = editorRef.current;

    if (!editorInstance) return;

    activeHighlightDefRef.current = null;
    highlightRangeRef.current = null;
    defHighlightDecorationsRef.current = editorInstance.deltaDecorations(
      defHighlightDecorationsRef.current,
      [],
    );
  }, []);
  /**
   * Call inside Monaco's `onMount` after setting `editorRef.current`.
   * Reveals the current `highlightDef` (if any) and registers the mousedown
   * handler that clears the highlight on outside-range clicks.
   */
  const setupHighlightOnMount = useCallback(
    (editorInstance: editor.IStandaloneCodeEditor) => {
      if (highlightDefRef.current) {
        revealNodeDef(highlightDefRef.current);
      }
      editorInstance.onMouseDown((e) => {
        if (!activeHighlightDefRef.current || !highlightRangeRef.current) {
          return;
        }

        const clickedLine = e.target.position?.lineNumber;

        if (
          clickedLine === undefined ||
          clickedLine < highlightRangeRef.current.startLine ||
          clickedLine > highlightRangeRef.current.endLine
        ) {
          activeHighlightDefRef.current = null;
          highlightRangeRef.current = null;
          defHighlightDecorationsRef.current = editorInstance.deltaDecorations(
            defHighlightDecorationsRef.current,
            [],
          );
          onHighlightClearRef.current?.();
        }
      });
    },
    [revealNodeDef],
  );

  // React to highlightDef changes after the editor is already mounted
  useEffect(() => {
    if (!editorRef.current) return;

    if (highlightDef) {
      revealNodeDef(highlightDef);
    } else {
      clearNodeDefHighlight();
    }
  }, [highlightDef, revealNodeDef, clearNodeDefHighlight]);

  return { setupHighlightOnMount };
}
