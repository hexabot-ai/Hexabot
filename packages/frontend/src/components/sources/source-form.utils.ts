/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  type ChannelVisibility,
  type Source,
  type SourceFull,
} from "@hexabot-ai/types";
import type { RJSFSchema } from "@rjsf/utils";

import { EntityType } from "@/services/types";
import type { IChannel } from "@/types/channel.types";
import type { SearchPayload } from "@/types/search.types";
import { isRecord } from "@/utils/object";

type SourceLike = Source | SourceFull;
type SourceSearchPayload = SearchPayload<EntityType.SOURCE>;
export const CONSOLE_CHANNEL_NAME = "console";
export const PUBLIC_CHANNEL_VISIBILITY: ChannelVisibility = "public";
export const SYSTEM_CHANNEL_VISIBILITY: ChannelVisibility = "system";

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

export const getChannelVisibility = (
  channel: Pick<IChannel, "visibility"> | null | undefined,
): ChannelVisibility => channel?.visibility ?? PUBLIC_CHANNEL_VISIBILITY;

export const isSystemChannel = (
  channel: Pick<IChannel, "visibility"> | null | undefined,
): boolean => getChannelVisibility(channel) === SYSTEM_CHANNEL_VISIBILITY;

export const isSystemSourceChannel = (
  channelName: string | null | undefined,
  channelsByName: Record<string, IChannel> | null | undefined,
): boolean =>
  Boolean(
    channelName &&
      (isConsoleSourceChannel(channelName) ||
        isSystemChannel(channelsByName?.[channelName])),
  );

export const getPublicChannels = (channels: IChannel[]): IChannel[] =>
  channels.filter(
    (channel) =>
      !isConsoleSourceChannel(channel.name) && !isSystemChannel(channel),
  );

export const getSystemChannelNames = (channels: IChannel[]): string[] =>
  Array.from(
    new Set([
      CONSOLE_CHANNEL_NAME,
      ...channels
        .filter((channel) => isSystemChannel(channel))
        .map((channel) => channel.name),
    ]),
  );

export const getSourceDisplayChannelName = (
  channelName: string,
  channelsByName: Record<string, IChannel> | null | undefined,
  consoleLabel = "Admin test console",
): string => {
  if (isConsoleSourceChannel(channelName)) {
    return consoleLabel;
  }

  return channelsByName?.[channelName]?.name ?? channelName;
};

export const buildSourcesSearchParams = ({
  searchPayload,
  showSystemSources,
  systemChannelNames,
}: {
  searchPayload: SourceSearchPayload;
  showSystemSources: boolean;
  systemChannelNames: string[];
}): SourceSearchPayload => {
  if (showSystemSources || systemChannelNames.length === 0) {
    return searchPayload;
  }

  return {
    ...searchPayload,
    where: {
      ...(searchPayload.where ?? {}),
      channel: {
        "!=": systemChannelNames,
      },
    },
  };
};

export const resolveSourceState = (
  channelName: string,
  state: boolean,
): boolean => (isConsoleSourceChannel(channelName) ? true : state);

export const isSourceStateToggleDisabled = ({
  channelName,
  disabled,
}: {
  channelName: string;
  disabled: boolean;
}): boolean => disabled || isConsoleSourceChannel(channelName);

export const isSourceStateFieldHidden = ({
  channelName,
  channelsByName,
}: {
  channelName: string;
  channelsByName: Record<string, IChannel> | null | undefined;
}): boolean => isSystemSourceChannel(channelName, channelsByName);

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
