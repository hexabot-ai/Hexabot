/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { type Source, type SourceFull } from "@hexabot-ai/types";
import { describe, expect, it } from "vitest";

import {
  buildSourcePayload,
  buildSourceSettingsUiSchema,
  getSourceFormDefaults,
  isConsoleSourceChannel,
  isSourceChannelRegistered,
  isSourceStateToggleDisabled,
  pruneSourceSettingsBySchema,
  resolveDefaultWorkflowId,
  resolveSourceChannel,
  resolveSourceSettingsSchema,
  resolveSourceState,
  shouldDisableSourceFormSubmit,
} from "./source-form.utils";

describe("source form utils", () => {
  describe("resolveSourceChannel", () => {
    it("prefers source channel over preset channel", () => {
      expect(
        resolveSourceChannel({ channel: "web" } as Source, "console"),
      ).toBe("web");
    });

    it("falls back to preset channel and then empty string", () => {
      expect(resolveSourceChannel(null, "console")).toBe("console");
      expect(resolveSourceChannel(null, undefined)).toBe("");
    });
  });

  describe("isSourceChannelRegistered", () => {
    it("detects registered source channels from channel metadata", () => {
      expect(
        isSourceChannelRegistered("web", {
          web: {
            id: "web",
            name: "web",
            createdAt: new Date(),
            updatedAt: new Date(),
            settingsSchema: {},
          },
        }),
      ).toBe(true);
    });

    it("returns false when source channel metadata is missing", () => {
      expect(isSourceChannelRegistered("custom-channel", {})).toBe(false);
      expect(isSourceChannelRegistered("", {})).toBe(false);
      expect(isSourceChannelRegistered("web", undefined)).toBe(false);
    });
  });

  describe("console source helpers", () => {
    it("detects console channels", () => {
      expect(isConsoleSourceChannel("console")).toBe(true);
      expect(isConsoleSourceChannel("web")).toBe(false);
      expect(isConsoleSourceChannel(undefined)).toBe(false);
    });

    it("forces console source state to enabled in payloads", () => {
      expect(resolveSourceState("console", false)).toBe(true);
      expect(resolveSourceState("console", true)).toBe(true);
      expect(resolveSourceState("web", false)).toBe(false);
    });

    it("locks only active console source toggles", () => {
      expect(
        isSourceStateToggleDisabled({
          channelName: "console",
          state: true,
          disabled: false,
        }),
      ).toBe(true);
      expect(
        isSourceStateToggleDisabled({
          channelName: "console",
          state: false,
          disabled: false,
        }),
      ).toBe(false);
      expect(
        isSourceStateToggleDisabled({
          channelName: "web",
          state: true,
          disabled: false,
        }),
      ).toBe(false);
      expect(
        isSourceStateToggleDisabled({
          channelName: "console",
          state: false,
          disabled: true,
        }),
      ).toBe(true);
    });
  });

  describe("shouldDisableSourceFormSubmit", () => {
    it("keeps submit enabled for a valid registered channel form", () => {
      expect(
        shouldDisableSourceFormSubmit({
          channelName: "web",
          isUnregisteredChannel: false,
          hasSettingsErrors: false,
          hasNameError: false,
        }),
      ).toBe(false);
    });

    it("disables submit for missing, invalid, or unregistered channel forms", () => {
      expect(
        shouldDisableSourceFormSubmit({
          channelName: "",
          isUnregisteredChannel: false,
          hasSettingsErrors: false,
          hasNameError: false,
        }),
      ).toBe(true);
      expect(
        shouldDisableSourceFormSubmit({
          channelName: "web",
          isUnregisteredChannel: true,
          hasSettingsErrors: false,
          hasNameError: false,
        }),
      ).toBe(true);
      expect(
        shouldDisableSourceFormSubmit({
          channelName: "web",
          isUnregisteredChannel: false,
          hasSettingsErrors: true,
          hasNameError: false,
        }),
      ).toBe(true);
      expect(
        shouldDisableSourceFormSubmit({
          channelName: "web",
          isUnregisteredChannel: false,
          hasSettingsErrors: false,
          hasNameError: true,
        }),
      ).toBe(true);
    });
  });

  describe("resolveSourceSettingsSchema", () => {
    it("returns an object schema fallback when input schema is invalid", () => {
      expect(resolveSourceSettingsSchema(undefined)).toEqual({
        type: "object",
        properties: {},
      });
    });

    it("normalizes settings schema as object and preserves properties", () => {
      expect(
        resolveSourceSettingsSchema({
          title: "Web Channel",
          properties: {
            greeting_message: { type: "string" },
            show_file: { type: "boolean" },
          },
        }),
      ).toEqual({
        title: "Web Channel",
        type: "object",
        properties: {
          greeting_message: { type: "string" },
          show_file: { type: "boolean" },
        },
      });
    });
  });

  describe("buildSourceSettingsUiSchema", () => {
    it("keeps property order and removes duplicated root title", () => {
      expect(
        buildSourceSettingsUiSchema({
          type: "object",
          properties: {
            first: { type: "string" },
            second: { type: "boolean" },
          },
        }),
      ).toEqual({
        "ui:title": "",
        "ui:order": ["first", "second"],
      });
    });
  });

  describe("pruneSourceSettingsBySchema", () => {
    it("keeps only settings declared by the active schema", () => {
      expect(
        pruneSourceSettingsBySchema(
          {
            greeting_message: "legacy",
            start_button: true,
            input_disabled: false,
            show_file: true,
          },
          {
            type: "object",
            properties: {
              input_disabled: { type: "boolean" },
              show_file: { type: "boolean" },
            },
          },
        ),
      ).toEqual({
        input_disabled: false,
        show_file: true,
      });
    });

    it("returns an empty object when the schema has no settings", () => {
      expect(
        pruneSourceSettingsBySchema(
          { input_disabled: false },
          {
            type: "object",
            properties: {},
          },
        ),
      ).toEqual({});
    });
  });

  describe("resolveDefaultWorkflowId", () => {
    it("normalizes workflow ids from string or populated workflow object", () => {
      expect(resolveDefaultWorkflowId("wf_1")).toBe("wf_1");
      expect(
        resolveDefaultWorkflowId({
          id: "wf_2",
        } as unknown as SourceFull["defaultWorkflow"]),
      ).toBe("wf_2");
      expect(resolveDefaultWorkflowId(null)).toBeNull();
    });
  });

  describe("getSourceFormDefaults", () => {
    it("builds safe defaults for source form", () => {
      expect(getSourceFormDefaults(undefined)).toEqual({
        name: "",
        state: true,
        settings: {},
        defaultWorkflow: null,
      });
    });
  });

  describe("buildSourcePayload", () => {
    it("trims names and normalizes workflow relation", () => {
      expect(
        buildSourcePayload({
          channel: "web",
          name: "  Main Web Source  ",
          state: true,
          settings: { greeting_message: "hello" },
          defaultWorkflow: {
            id: "wf_1",
          } as unknown as SourceFull["defaultWorkflow"],
        }),
      ).toEqual({
        channel: "web",
        name: "Main Web Source",
        state: true,
        settings: { greeting_message: "hello" },
        defaultWorkflow: "wf_1",
      });
    });

    it("forces console sources enabled and prunes removed settings", () => {
      expect(
        buildSourcePayload({
          channel: "console",
          name: "Console",
          state: false,
          settings: {
            greeting_message: "legacy",
            start_button: true,
            input_disabled: false,
          },
          settingsSchema: {
            type: "object",
            properties: {
              input_disabled: { type: "boolean" },
            },
          },
          defaultWorkflow: null,
        }),
      ).toEqual({
        channel: "console",
        name: "Console",
        state: true,
        settings: { input_disabled: false },
        defaultWorkflow: null,
      });
    });
  });
});
