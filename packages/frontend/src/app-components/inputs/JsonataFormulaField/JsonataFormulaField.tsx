/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import Editor, { OnMount } from "@monaco-editor/react";
import FunctionsRoundedIcon from "@mui/icons-material/FunctionsRounded";
import {
  Box,
  FormControl,
  FormHelperText,
  FormLabel,
  Tooltip,
} from "@mui/material";
import { useColorScheme, useTheme } from "@mui/material/styles";
import jsonata from "jsonata";
import * as React from "react";

import { useTranslate } from "@/hooks/useTranslate";

import { labelTooltipInputLabelSx } from "../JsonSchemaForm/widgets/shared";

import {
  ensureExpressionPrefix,
  isExpressionValue,
  looksLikeDynamicValueExpressionBody,
  shouldAppendCompletionDot,
  stripExpressionPrefix,
  toJsonataStringLiteral,
  validateDynamicValue,
} from "./dynamicValueUtils";
import { ExpressionAssist } from "./ExpressionAssist";
import { useJsonataGlobalsSchema } from "./globals-schema.context";
import { indexToLineCol } from "./jsonataUtils";
import {
  createCompletionProvider,
  handleEditorWillMount,
  registerJsonataLanguage,
} from "./monaco";
import { extractGlobals } from "./schema";
import type { JsonataFormulaFieldProps } from "./types";

const getValidationMessage = (
  validation: ReturnType<typeof validateDynamicValue>,
  t: ReturnType<typeof useTranslate>["t"],
) => {
  if (validation.code === "empty_dynamic") {
    return t("input.dynamic_value.errors.empty");
  }

  if (validation.code === "invalid_dynamic") {
    return (
      validation.errorMessage ?? t("input.dynamic_value.errors.invalid_jsonata")
    );
  }

  return null;
};

export function JsonataFormulaField(props: JsonataFormulaFieldProps) {
  const {
    label,
    required,
    value,
    onChange,
    onBlur,
    onFocus,
    globalsSchema,
    disabled,
    error = false,
    helperText,
    fullWidth,
    minHeightPx = 36,
    maxHeightPx = 220,
    enableExpressionAssist = false,
    onExpressionStateChange,
    sx,
  } = props;
  const { t } = useTranslate();
  const theme = useTheme();
  const contextGlobalsSchema = useJsonataGlobalsSchema();
  const resolvedGlobalsSchema = globalsSchema ?? contextGlobalsSchema;
  const { root, input, output, context } = React.useMemo(
    () => extractGlobals(resolvedGlobalsSchema),
    [resolvedGlobalsSchema],
  );
  const isJsonataMode = isExpressionValue(value);
  const monacoRef = React.useRef<typeof import("monaco-editor") | null>(null);
  const editorRef = React.useRef<
    import("monaco-editor").editor.IStandaloneCodeEditor | null
  >(null);
  const completionDisposableRef = React.useRef<
    import("monaco-editor").IDisposable | null
  >(null);
  const [height, setHeight] = React.useState<number>(minHeightPx);
  const [assistMenuAnchor, setAssistMenuAnchor] =
    React.useState<HTMLElement | null>(null);
  const prevIsJsonataMode = React.useRef<boolean>(isJsonataMode);
  const onBlurRef = React.useRef(onBlur);
  const onFocusRef = React.useRef(onFocus);

  React.useEffect(() => {
    onBlurRef.current = onBlur;
    onFocusRef.current = onFocus;
  }, [onBlur, onFocus]);

  const onMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco as any;
    editorRef.current = editor;

    registerJsonataLanguage(monaco as any);

    // Install completion provider (dispose previous if any)
    completionDisposableRef.current?.dispose();
    completionDisposableRef.current = createCompletionProvider(
      monaco as any,
      root,
      {
        input,
        output,
        context,
      },
      editor.getModel(),
    );

    // Set initial language based on current value
    const model = editor.getModel();

    if (model) {
      monaco.editor.setModelLanguage(
        model,
        isJsonataMode ? "jsonata" : "plaintext",
      );
    }

    // Auto-size editor height
    const updateHeight = () => {
      const content = Math.min(
        maxHeightPx,
        Math.max(minHeightPx, editor.getContentHeight()),
      );

      setHeight(content);
      editor.layout({ width: editor.getLayoutInfo().width, height: content });
    };

    updateHeight();

    const sub = editor.onDidContentSizeChange(updateHeight);
    const blurSub = editor.onDidBlurEditorText(() => {
      onBlurRef.current?.(editor.getValue());
    });
    const focusSub = editor.onDidFocusEditorText(() => {
      onFocusRef.current?.(editor.getValue());
    });

    // clicking wrapper should focus editor (handled by wrapper onClick)
    return () => {
      sub.dispose();
      blurSub.dispose();
      focusSub.dispose();
    };
  };

  // Re-install completion provider if schema changes
  React.useEffect(() => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel();

    if (!monaco || !model) return;

    completionDisposableRef.current?.dispose();
    completionDisposableRef.current = createCompletionProvider(
      monaco,
      root,
      {
        input,
        output,
        context,
      },
      model,
    );

    return () => {
      completionDisposableRef.current?.dispose();
      completionDisposableRef.current = null;
    };
  }, [root, input, output, context]);

  // Switch language when the user adds/removes leading '='
  React.useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;

    if (!monaco || !editor) return;
    const model = editor.getModel();

    if (!model) return;

    monaco.editor.setModelLanguage(
      model,
      isJsonataMode ? "jsonata" : "plaintext",
    );

    // nice UX: when entering jsonata mode, pop suggestions
    const was = prevIsJsonataMode.current;

    if (!was && isJsonataMode) {
      editor.focus();
      editor.trigger("jsonata", "editor.action.triggerSuggest", null);
    }

    prevIsJsonataMode.current = isJsonataMode;
  }, [isJsonataMode]);

  const validationResult = React.useMemo(() => {
    return validateDynamicValue(value);
  }, [value]);
  const validationMessage = getValidationMessage(validationResult, t);

  React.useEffect(() => {
    onExpressionStateChange?.({
      hasError: Boolean(validationMessage),
      isExpression: validationResult.isExpression,
      suppressSchemaErrors: validationResult.suppressSchemaErrors,
    });
  }, [onExpressionStateChange, validationMessage, validationResult]);

  // Syntax validation (debounced)
  React.useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;

    if (!monaco || !editor) return;

    const model = editor.getModel();

    if (!model) return;

    const handle = window.setTimeout(() => {
      // Clear markers in plain mode
      if (!isJsonataMode) {
        monaco.editor.setModelMarkers(model, "jsonata", []);

        return;
      }

      const expr = stripExpressionPrefix(value);

      if (validationResult.code === "empty_dynamic") {
        monaco.editor.setModelMarkers(model, "jsonata", [
          {
            severity: monaco.MarkerSeverity.Error,
            message: validationMessage ?? t("input.dynamic_value.errors.empty"),
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 2,
          },
        ]);

        return;
      }

      if (!expr.trim()) {
        monaco.editor.setModelMarkers(model, "jsonata", []);

        return;
      }

      try {
        // compilation == syntax check
        jsonata(expr);

        monaco.editor.setModelMarkers(model, "jsonata", []);
      } catch (e: any) {
        const message = e?.message
          ? String(e.message)
          : t("input.dynamic_value.errors.invalid_jsonata");
        const posIndex: number =
          typeof e?.position === "number"
            ? e.position
            : typeof e?.offset === "number"
              ? e.offset
              : 0;
        const { line, col } = indexToLineCol(expr, Math.max(0, posIndex));
        const lineNumber = line + 1;
        const startColumn = col + 1 + (line === 0 ? 1 : 0);
        const endColumn = startColumn + 1;

        monaco.editor.setModelMarkers(model, "jsonata", [
          {
            severity: monaco.MarkerSeverity.Error,
            message,
            startLineNumber: lineNumber,
            startColumn,
            endLineNumber: lineNumber,
            endColumn,
          },
        ]);
      }
    }, 200);

    return () => window.clearTimeout(handle);
  }, [isJsonataMode, t, validationMessage, validationResult.code, value]);

  const handleEditorChange = (nextEditorValue?: string) => {
    onChange(nextEditorValue ?? "");
  };
  const appendDotForPathCompletion = (
    editor: import("monaco-editor").editor.IStandaloneCodeEditor,
    monaco: typeof import("monaco-editor"),
  ) => {
    const model = editor.getModel();
    const position = editor.getPosition();

    if (!model || !position) {
      return;
    }

    const textBeforeCursor = model.getValueInRange({
      startLineNumber: position.lineNumber,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    });

    if (!shouldAppendCompletionDot(textBeforeCursor)) {
      return;
    }

    editor.executeEdits("dynamic-value", [
      {
        range: new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          position.column,
        ),
        text: ".",
        forceMoveMarkers: true,
      },
    ]);
    editor.setPosition({
      lineNumber: position.lineNumber,
      column: position.column + 1,
    });
  };
  const focusDynamicValueEditor = (
    editor: import("monaco-editor").editor.IStandaloneCodeEditor,
    monaco: typeof import("monaco-editor"),
    options: { triggerSuggestions?: boolean } = { triggerSuggestions: true },
  ) => {
    const model = editor.getModel();

    if (model) {
      monaco.editor.setModelLanguage(model, "jsonata");
    }

    if (options.triggerSuggestions) {
      appendDotForPathCompletion(editor, monaco);
    }

    editor.focus();

    if (options.triggerSuggestions) {
      editor.trigger("dynamic-value", "editor.action.triggerSuggest", null);
    }
  };
  const replaceEditorValue = (
    nextValue: string,
    options: { triggerSuggestions?: boolean } = { triggerSuggestions: true },
  ) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    if (!editor || !monaco) {
      onChange(nextValue);

      return;
    }

    editor.setValue(nextValue);
    editor.setPosition({ lineNumber: 1, column: nextValue.length + 1 });
    focusDynamicValueEditor(editor, monaco, options);
  };
  const handleExpressionAssist = (anchor: HTMLElement) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    if (!editor || !monaco) {
      if (
        !value.trim() ||
        isExpressionValue(value) ||
        looksLikeDynamicValueExpressionBody(value)
      ) {
        onChange(ensureExpressionPrefix(value));
      } else {
        setAssistMenuAnchor(anchor);
      }

      return;
    }

    const editorCurrentValue = editor.getValue();

    if (isExpressionValue(editorCurrentValue)) {
      focusDynamicValueEditor(editor, monaco);

      return;
    }

    if (!editorCurrentValue.trim()) {
      replaceEditorValue("=");

      return;
    }

    if (looksLikeDynamicValueExpressionBody(editorCurrentValue)) {
      replaceEditorValue(ensureExpressionPrefix(editorCurrentValue));

      return;
    }

    setAssistMenuAnchor(anchor);
  };
  const closeAssistMenu = () => setAssistMenuAnchor(null);
  const replaceWithDynamicValue = () => {
    closeAssistMenu();
    replaceEditorValue("=");
  };
  const convertStaticTextToDynamicString = () => {
    const currentValue = editorRef.current?.getValue() ?? value;

    closeAssistMenu();
    replaceEditorValue(toJsonataStringLiteral(currentValue), {
      triggerSuggestions: false,
    });
  };
  const showError = error || Boolean(validationMessage);
  const { mode } = useColorScheme();
  const showAssistIcon = enableExpressionAssist;
  const showModeIcon = !showAssistIcon && isJsonataMode;
  const modeLabel = t("input.jsonata_formula_mode");
  const resolvedHelperText = showError ? validationMessage : helperText;

  return (
    <FormControl
      fullWidth={fullWidth}
      disabled={disabled}
      error={showError}
      required={required}
      sx={sx}
      component="fieldset"
      variant="standard"
    >
      {label ? (
        <FormLabel sx={labelTooltipInputLabelSx} required={required}>
          {label}
        </FormLabel>
      ) : null}
      <Box
        className="nokey"
        onClick={() => editorRef.current?.focus()}
        sx={(theme) => {
          const resolvedTheme = theme.vars || theme;
          const errorBorderColor = resolvedTheme.palette.error.main;
          const borderColor = showError
            ? errorBorderColor
            : resolvedTheme.palette.divider;
          const focusBorderColor = showError
            ? errorBorderColor
            : resolvedTheme.palette.primary.main;
          const hoverBorderColor = showError
            ? errorBorderColor
            : resolvedTheme.palette.grey[400];
          const disabledBackground =
            resolvedTheme.palette.grey[300] ??
            resolvedTheme.palette.background.default;

          return {
            position: "relative",
            width: "100%",
            borderRadius: resolvedTheme.shape.borderRadius,
            border: "1px solid",
            paddingLeft: theme.spacing(1),
            paddingRight:
              showModeIcon || showAssistIcon
                ? theme.spacing(4.5)
                : theme.spacing(1),
            borderColor,
            backgroundColor: disabled
              ? disabledBackground
              : resolvedTheme.palette.background.default,
            transition:
              "border-color 120ms ease-in, background-color 120ms ease-in",
            boxSizing: "border-box",
            overflow: "hidden",
            cursor: disabled ? "not-allowed" : "text",
            "&:hover": {
              borderColor: disabled ? borderColor : hoverBorderColor,
            },
            "&:focus-within": {
              borderColor: focusBorderColor,
            },
            ...(disabled
              ? {
                  "& .monaco-editor, & .monaco-editor .margin, & .monaco-editor-background":
                    {
                      backgroundColor: `${disabledBackground} !important`,
                    },
                }
              : null),
            ...theme.applyStyles("dark", {
              ...(disabled
                ? {
                    backgroundColor: resolvedTheme.palette.grey[600],
                    "& .monaco-editor, & .monaco-editor .margin, & .monaco-editor-background":
                      {
                        backgroundColor: `${resolvedTheme.palette.grey[600]} !important`,
                      },
                  }
                : null),
              "&:hover": {
                borderColor: disabled
                  ? borderColor
                  : showError
                    ? errorBorderColor
                    : resolvedTheme.palette.grey[500],
              },
            }),
          };
        }}
      >
        {showModeIcon ? (
          <Tooltip title={modeLabel} arrow>
            <Box
              component="span"
              aria-label={modeLabel}
              sx={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                display: "inline-flex",
                alignItems: "center",
                color: disabled ? "text.disabled" : "text.secondary",
                zIndex: 1,
                pointerEvents: "auto",
              }}
            >
              <FunctionsRoundedIcon sx={{ fontSize: 16 }} />
            </Box>
          </Tooltip>
        ) : null}
        {showAssistIcon ? (
          <ExpressionAssist
            disabled={disabled}
            isExpression={isJsonataMode}
            menuAnchor={assistMenuAnchor}
            onConvertStaticText={convertStaticTextToDynamicString}
            onMenuClose={closeAssistMenu}
            onOpen={handleExpressionAssist}
            onReplaceWithExpression={replaceWithDynamicValue}
          />
        ) : null}
        <Editor
          value={value}
          onChange={handleEditorChange}
          onMount={onMount}
          theme={mode}
          beforeMount={handleEditorWillMount}
          language={isJsonataMode ? "jsonata" : "plaintext"}
          height={`${height}px`}
          options={{
            readOnly: Boolean(disabled),
            minimap: { enabled: false },
            lineNumbers: "off",
            folding: false,
            wordWrap: "on",
            scrollBeyondLastLine: false,
            scrollbar: {
              vertical: "hidden",
              horizontal: "hidden",
              handleMouseWheel: true,
            },
            overviewRulerLanes: 0,
            renderLineHighlight: "none",
            glyphMargin: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 0,
            tabSize: 2,
            fontFamily: theme.typography.fontFamily,
            fontSize: theme.typography.htmlFontSize,
            lineHeight: theme.typography.htmlFontSize * 1.25,
            fontWeight: String(theme.typography.fontWeightRegular),
            padding: {
              top: theme.typography.htmlFontSize / 2,
              bottom: theme.typography.htmlFontSize / 2,
            },
            suggestOnTriggerCharacters: true,
            quickSuggestions: true,
            parameterHints: { enabled: true },
            // Keep spacebar usable when suggestions are open.
            acceptSuggestionOnCommitCharacter: false,
            fixedOverflowWidgets: true,
          }}
        />
      </Box>
      {resolvedHelperText != null ? (
        <FormHelperText sx={{ mt: 0.5 }}>{resolvedHelperText}</FormHelperText>
      ) : null}
    </FormControl>
  );
}
