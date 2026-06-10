/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useTranslation } from "../hooks/useTranslation";
import { ThemeOverrides } from "../theme/theme.types";
import { IMenuNode } from "../types/menu.type";
import { SubscriberFull, Web } from "../types/message.types";
import { SessionStorage } from "../utils/sessionStorage";

import { useConfig } from "./ConfigProvider";
import { useSubscribe } from "./SocketProvider";

const LEGACY_SETTINGS_STORAGE_KEY = "settings";
const getScopedSettingsStorageKey = ({
  apiUrl,
  sourceId,
  instanceId,
}: {
  apiUrl: string;
  sourceId: string;
  instanceId?: string;
}) => {
  const scope = instanceId?.trim() || `${apiUrl}::${sourceId}`;

  return `hexabot:widget:settings:${encodeURIComponent(scope)}`;
};

export type ChannelSettings = {
  menu: IMenuNode[];
  secret: string;
  allowed_domains: string;
  start_button: boolean;
  input_disabled: boolean;
  persistent_menu: boolean;
  theme?: ThemeOverrides;
  window_title: string;
  avatar_url?: string;
  show_emoji: boolean;
  show_file: boolean;
  show_location: boolean;
  allowed_upload_types: string;
  greeting_message: string;
  messages?: Web.Message[];
  profile?: SubscriberFull;
  thread_id?: string | null;
};

export type ChatSettings = {
  showEmoji: boolean;
  showFile: boolean;
  showLocation: boolean;
  showTypingIndicator: boolean;
  alwaysScrollToBottom: boolean;
  focusOnOpen: boolean;
  title: string;
  titleImageUrl: string;
  inputDisabled: boolean;
  placeholder: string;
  menu: IMenuNode[];
  autoFlush: boolean;
  allowedUploadTypes: string[];
  theme?: ThemeOverrides;
  greetingMessage: string;
  avatarUrl: string;
};

const defaultSettings: ChatSettings = {
  showEmoji: true,
  showFile: true,
  showLocation: true,
  showTypingIndicator: true,
  alwaysScrollToBottom: true,
  focusOnOpen: true,
  title: "Hexabot :)",
  titleImageUrl: "",
  inputDisabled: false,
  placeholder: "Write something...",
  menu: [],
  autoFlush: true,
  allowedUploadTypes: ["image/gif", "image/png", "image/jpeg"],
  theme: undefined,
  greetingMessage: "Welcome !",
  avatarUrl: "",
};
const SettingsContext = createContext<ChatSettings>(defaultSettings);

interface ChatSettingsProviderProps {
  children: ReactNode;
}
export const SettingsProvider: React.FC<ChatSettingsProviderProps> = ({
  children,
}) => {
  const { apiUrl, sourceId, instanceId } = useConfig();
  const { t } = useTranslation();
  const settingsStorageKey = useMemo(
    () =>
      getScopedSettingsStorageKey({
        apiUrl,
        sourceId,
        instanceId,
      }),
    [apiUrl, sourceId, instanceId],
  );
  const scopedSettings = useMemo(() => {
    return SessionStorage.getItem<ChatSettings>(settingsStorageKey);
  }, [settingsStorageKey]);
  const legacySettings = useMemo(() => {
    return SessionStorage.getItem<ChatSettings>(LEGACY_SETTINGS_STORAGE_KEY);
  }, []);
  const defaultOrSavedSettings = scopedSettings ?? legacySettings;
  const [settings, setSettingsState] = useState(
    defaultOrSavedSettings || defaultSettings,
  );
  const setSettings = useCallback(
    (settings: ChatSettings) => {
      SessionStorage.setItem(settingsStorageKey, settings);
      setSettingsState(settings);
    },
    [settingsStorageKey],
  );

  useEffect(() => {
    if (!scopedSettings && legacySettings) {
      SessionStorage.setItem(settingsStorageKey, legacySettings);
    }
  }, [scopedSettings, legacySettings, settingsStorageKey]);

  useSubscribe("settings", (settings: ChannelSettings) => {
    const avatarUrl = settings.avatar_url?.trim() || "";

    setSettings({
      ...defaultSettings,
      showEmoji: settings.show_emoji,
      showFile: settings.show_file,
      showLocation: settings.show_location,
      title: settings.window_title,
      titleImageUrl: avatarUrl,
      menu: settings.menu,
      allowedUploadTypes: settings.allowed_upload_types
        ? settings.allowed_upload_types.split(",")
        : defaultSettings.allowedUploadTypes,
      inputDisabled: settings.input_disabled,
      theme: settings.theme,
      greetingMessage: settings.greeting_message,
      placeholder: t("settings.placeholder"),
      avatarUrl,
    });
  });

  return (
    <SettingsContext.Provider value={settings}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  return useContext(SettingsContext);
};
