/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { useChat } from "../providers/ChatProvider";
import { useConfig } from "../providers/ConfigProvider";
import { useSettings } from "../providers/SettingsProvider";
import { useWidget } from "../providers/WidgetProvider";
import { ConfigProfile } from "../types/config.types";
import { IMenuNode } from "../types/menu.type";
import {
  SubscriberFull,
  Suggestion,
  UiMessage,
  Web,
} from "../types/message.types";
import { ConnectionState } from "../types/state.types";
import { getFileError } from "../utils/attachment";

import { useTranslation } from "./useTranslation";

/**
 * The chat state and actions the package exports as `useChat()`, for host
 * components rendered inside `UiChatWidget` (composer, pre-chat screen,
 * header, launcher, children).
 *
 * Sends resolve once the server acknowledges the message. A failed send
 * does not reject: it moves `connectionState` to `error`.
 */
export type ChatApi = {
  /** The conversation, oldest first. */
  messages: UiMessage[];
  connectionState: ConnectionState;
  /** The subscribed visitor, once known. */
  profile?: SubscriberFull;
  /** Quick replies offered by the last message. */
  suggestions: Suggestion[];
  /** The source's persistent menu. */
  menu: IMenuNode[];
  /** Whether the chat window is open. */
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /**
   * Subscribes the visitor, as the name form does, but sends no
   * GET_STARTED postback. Missing names fall back to the API defaults.
   */
  subscribe: (profile?: ConfigProfile) => Promise<void>;
  sendText: (text: string) => Promise<void>;
  /** Rejects without sending a file the source does not accept. */
  sendFile: (file: File) => Promise<void>;
  /** Sends a button press: `payload` drives the workflow, `title` shows. */
  sendPostback: (payload: string, title: string) => Promise<void>;
  sendQuickReply: (suggestion: Suggestion) => Promise<void>;
};

export const useChatApi = (): ChatApi => {
  const chat = useChat();
  const { menu, allowedUploadTypes } = useSettings();
  const { maxUploadSize } = useConfig();
  const { isOpen, setIsOpen } = useWidget();
  const { t } = useTranslation();
  const { send } = chat;

  return {
    messages: chat.messages,
    connectionState: chat.connectionState,
    profile: chat.profile,
    suggestions: chat.suggestions,
    menu,
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    subscribe: (profile) =>
      chat.handleSubscription(profile?.firstName, profile?.lastName),
    sendText: (text) =>
      send({ data: { type: Web.InboundMessageType.text, data: { text } } }),
    sendFile: async (file) => {
      const error = getFileError(file, allowedUploadTypes, maxUploadSize);

      if (error) {
        throw new Error(t(error));
      }

      await send({
        data: {
          type: Web.InboundMessageType.file,
          data: { name: file.name, size: file.size, type: file.type, file },
        },
      });
    },
    sendPostback: (payload, title) =>
      send({
        data: {
          type: Web.InboundMessageType.postback,
          data: { payload, text: title },
        },
      }),
    sendQuickReply: ({ text, payload }) =>
      send({
        data: {
          type: Web.InboundMessageType.quick_reply,
          data: { text, payload },
        },
      }),
  };
};
