/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { type Source, type SourceFull } from "@hexabot-ai/types";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";

import { extractUiSchema } from "@/components/visual-editor/v4/utils/schema-defaults.utils";
import type { IChannel } from "@/types/channel.types";
import { isRecord } from "@/utils/object";

type SourceLike = Source | SourceFull;
export const CONSOLE_CHANNEL_NAME = "console";

export const EMPTY_SOURCE_SETTINGS_SCHEMA: RJSFSchema = {
  type: "object",
  properties: {},
} as const;

const normalizeSourceSettings = (
  settings: unknown,
): Record<string, unknown> => {
  return isRecord(settings) ? settings : {};
};

export const resolveSourceChannel = (
  source: Pick<SourceLike, "channel"> | null | undefined,
  presetChannel?: string,
) => source?.channel ?? presetChannel ?? "";

export const isSourceChannelRegistered = (
  channelName: string | null | undefined,
  channelsByName: Record<string, IChannel> | null | undefined,
): boolean => Boolean(channelName && channelsByName?.[channelName]);

export const isConsoleSourceChannel = (
  channelName: string | null | undefined,
): boolean => channelName === CONSOLE_CHANNEL_NAME;

export const resolveSourceState = (
  channelName: string,
  state: boolean,
): boolean => (isConsoleSourceChannel(channelName) ? true : state);

export const isSourceStateToggleDisabled = ({
  channelName,
  state,
  disabled,
}: {
  channelName: string;
  state: boolean;
  disabled: boolean;
}): boolean => disabled || (isConsoleSourceChannel(channelName) && state);

export const shouldDisableSourceFormSubmit = ({
  channelName,
  isUnregisteredChannel,
  hasSettingsErrors,
  hasNameError,
}: {
  channelName: string;
  isUnregisteredChannel: boolean;
  hasSettingsErrors: boolean;
  hasNameError: boolean;
}): boolean =>
  !channelName || isUnregisteredChannel || hasSettingsErrors || hasNameError;

export const resolveSourceSettingsSchema = (schema: unknown): RJSFSchema => {
  if (!isRecord(schema)) {
    return EMPTY_SOURCE_SETTINGS_SCHEMA;
  }

  const properties = isRecord(schema.properties)
    ? (schema.properties as RJSFSchema["properties"])
    : {};

  return {
    ...(schema as RJSFSchema),
    type: "object",
    properties,
  };
};

export const buildSourceSettingsUiSchema = (schema: RJSFSchema): UiSchema => {
  const extracted = extractUiSchema(schema);
  const order = Object.keys(schema.properties || {});

  return {
    ...extracted,
    "ui:title": "",
    ...(order.length ? { "ui:order": order } : {}),
  };
};

export const pruneSourceSettingsBySchema = (
  settings: unknown,
  schema: RJSFSchema,
): Record<string, unknown> => {
  const normalizedSettings = normalizeSourceSettings(settings);
  const propertyNames = Object.keys(schema.properties || {});

  if (propertyNames.length === 0) {
    return {};
  }

  return propertyNames.reduce<Record<string, unknown>>((acc, key) => {
    if (Object.prototype.hasOwnProperty.call(normalizedSettings, key)) {
      acc[key] = normalizedSettings[key];
    }

    return acc;
  }, {});
};

export const resolveDefaultWorkflowId = (
  value: SourceLike["defaultWorkflow"] | null | undefined,
): string | null => {
  if (typeof value === "string") {
    const normalized = value.trim();

    return normalized.length > 0 ? normalized : null;
  }

  if (isRecord(value) && typeof value.id === "string") {
    const normalized = value.id.trim();

    return normalized.length > 0 ? normalized : null;
  }

  return null;
};

export const getSourceFormDefaults = (
  source: SourceLike | null | undefined,
): {
  name: string;
  state: boolean;
  settings: Record<string, unknown>;
  defaultWorkflow: string | null;
} => ({
  name: source?.name ?? "",
  state: source?.state ?? true,
  settings: normalizeSourceSettings(source?.settings),
  defaultWorkflow: resolveDefaultWorkflowId(source?.defaultWorkflow),
});

export const buildSourcePayload = ({
  channel,
  name,
  state,
  settings,
  settingsSchema,
  defaultWorkflow,
}: {
  channel: string;
  name: string;
  state: boolean;
  settings: Record<string, unknown>;
  settingsSchema?: RJSFSchema;
  defaultWorkflow: SourceLike["defaultWorkflow"] | null | undefined;
}) => ({
  channel,
  name: name.trim(),
  state: resolveSourceState(channel, state),
  settings: settingsSchema
    ? pruneSourceSettingsBySchema(settings, settingsSchema)
    : normalizeSourceSettings(settings),
  defaultWorkflow: resolveDefaultWorkflowId(defaultWorkflow),
});
