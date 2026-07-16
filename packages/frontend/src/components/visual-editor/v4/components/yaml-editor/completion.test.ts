/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Monaco } from "@monaco-editor/react";
import { describe, expect, it, vi } from "vitest";

import type { IAction } from "@/types/action.types";

import { registerYamlCompletionProvider } from "./completion";
import { YAML_LANGUAGE_ID } from "./constants";

type CompletionProvider = Parameters<
  Monaco["languages"]["registerCompletionItemProvider"]
>[1];

const createMonacoMock = () => {
  let provider: CompletionProvider | undefined;

  const monaco = {
    languages: {
      CompletionItemKind: {
        Snippet: 1,
        Reference: 2,
        Function: 3,
        Field: 4,
      },
      CompletionItemInsertTextRule: {
        InsertAsSnippet: 4,
      },
      registerCompletionItemProvider: vi.fn(
        (languageId, completionProvider) => {
          if (languageId === YAML_LANGUAGE_ID) {
            provider = completionProvider;
          }

          return { dispose: vi.fn() };
        },
      ),
    },
  } as unknown as Monaco;

  return {
    monaco,
    getProvider: () => provider,
  };
};
/**
 * A minimal multi-line model mock supporting the line-by-line lookback that
 * `buildInputsCompletionItems` relies on to find the enclosing task's
 * `action:` value.
 */
const createModelMock = (lines: string[]) =>
  ({
    getLineCount: () => lines.length,
    getLineContent: (lineNumber: number) => lines[lineNumber - 1] ?? "",
    getWordUntilPosition: (position: { column: number }) => ({
      word: "",
      startColumn: position.column,
      endColumn: position.column,
    }),
  }) as never;

describe("yaml completion", () => {
  it("suggests task ids from provider state for flow do references", () => {
    const { monaco, getProvider } = createMonacoMock();

    registerYamlCompletionProvider(monaco, undefined, () => ["task_alpha"]);

    const provider = getProvider();

    if (!provider) {
      throw new Error("Expected YAML completion provider to be registered");
    }

    const doLine = "  - do: ";
    const suggestions = provider.provideCompletionItems(
      {
        getLineContent: () => doLine,
        getWordUntilPosition: () => ({
          word: "",
          startColumn: doLine.length + 1,
          endColumn: doLine.length + 1,
        }),
      } as never,
      {
        lineNumber: 9,
        column: doLine.length + 1,
      } as never,
      { triggerCharacter: ":" } as never,
      {} as never,
    ).suggestions;

    expect(suggestions.map((suggestion) => suggestion.label)).toContain(
      "task_alpha",
    );
  });

  it("suggests the action's real input keys under a task's inputs: block, excluding keys already present", () => {
    const { monaco, getProvider } = createMonacoMock();
    const aiAgentAction = {
      name: "ai_agent",
      inputSchema: {
        type: "object",
        properties: {
          input_mode: { type: "string", title: "Input mode" },
          prompt: { type: "string", title: "Prompt" },
          messages_limit: { type: "integer", title: "Messages limit" },
          system: { type: "string", title: "System" },
        },
      },
    } as unknown as IAction;

    registerYamlCompletionProvider(monaco, () => [aiAgentAction]);

    const provider = getProvider();

    if (!provider) {
      throw new Error("Expected YAML completion provider to be registered");
    }

    const model = createModelMock([
      "defs:",
      "  ai_agent:",
      "    kind: task",
      "    action: ai_agent",
      "    inputs:",
      "      ",
      "      messages_limit: 4",
      "      system: You are a helpful assistant.",
    ]);
    const position = { lineNumber: 6, column: 7 };
    const suggestions = provider.provideCompletionItems(
      model,
      position as never,
      {} as never,
      {} as never,
    ).suggestions;
    const labels = suggestions.map((suggestion) => suggestion.label);

    expect(labels).toEqual(expect.arrayContaining(["input_mode", "prompt"]));
    expect(labels).not.toContain("messages_limit");
    expect(labels).not.toContain("system");
  });

  it("does not suggest action input keys for the workflow-level inputs: schema block", () => {
    const { monaco, getProvider } = createMonacoMock();
    const aiAgentAction = {
      name: "ai_agent",
      inputSchema: {
        type: "object",
        properties: {
          system: { type: "string", title: "System" },
        },
      },
    } as unknown as IAction;

    registerYamlCompletionProvider(monaco, () => [aiAgentAction]);

    const provider = getProvider();

    if (!provider) {
      throw new Error("Expected YAML completion provider to be registered");
    }

    const model = createModelMock(["inputs:", "  "]);
    const position = { lineNumber: 2, column: 3 };
    const suggestions = provider.provideCompletionItems(
      model,
      position as never,
      {} as never,
      {} as never,
    ).suggestions;

    expect(suggestions.map((suggestion) => suggestion.label)).not.toContain(
      "system",
    );
  });
});
