/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { PropsWithChildren, type ReactElement } from "react";

import Launcher from "./components/Launcher";
import UserSubscription from "./components/UserSubscription";
import BroadcastChannelProvider from "./providers/BroadcastChannelProvider";
import ChatProvider from "./providers/ChatProvider";
import { ConfigProvider } from "./providers/ConfigProvider";
import { SettingsProvider } from "./providers/SettingsProvider";
import { SocketProvider } from "./providers/SocketProvider";
import { ThemeProvider } from "./providers/ThemeProvider";
import { TranslationProvider } from "./providers/TranslationProvider";
import WidgetProvider, { WidgetContextType } from "./providers/WidgetProvider";
import { Config } from "./types/config.types";
import { SocketErrorHandlers } from "./types/message.types";
import { ChatScreen, ConnectionState } from "./types/state.types";

type UiChatWidgetProps = PropsWithChildren<{
  CustomLauncher?: (props: { widget: WidgetContextType }) => ReactElement;
  CustomHeader?: () => ReactElement | null;
  CustomAvatar?: () => ReactElement;
  /**
   * Replaces the input area under the messages, quick replies included.
   * Build it with `useChat()`; return `null` to drop the input area.
   */
  CustomComposer?: React.FC;
  /** Shown before the visitor subscribes. Defaults to the name form. */
  PreChat?: React.FC;
  PostChat?: React.FC;
  defaultIsOpen?: boolean;
  config: Partial<Config>;
  socketErrorHandlers?: SocketErrorHandlers;
}>;

/** `children` render inside the widget providers, after the launcher. */
function UiChatWidget({
  CustomHeader,
  CustomAvatar,
  CustomLauncher,
  CustomComposer,
  PreChat = UserSubscription,
  PostChat,
  config,
  defaultIsOpen,
  socketErrorHandlers,
  children,
}: UiChatWidgetProps) {
  return (
    <ConfigProvider {...config}>
      <TranslationProvider>
        <SocketProvider socketErrorHandlers={socketErrorHandlers}>
          <SettingsProvider>
            <ThemeProvider>
              <BroadcastChannelProvider channelName="main-channel">
                <WidgetProvider
                  defaultScreen={ChatScreen.CHAT}
                  defaultIsOpen={defaultIsOpen}
                >
                  <ChatProvider
                    defaultConnectionState={ConnectionState.connected}
                  >
                    <Launcher
                      CustomLauncher={CustomLauncher}
                      CustomHeader={CustomHeader}
                      CustomAvatar={CustomAvatar}
                      CustomComposer={CustomComposer}
                      PreChat={PreChat}
                      PostChat={PostChat}
                    />
                    {children}
                  </ChatProvider>
                </WidgetProvider>
              </BroadcastChannelProvider>
            </ThemeProvider>
          </SettingsProvider>
        </SocketProvider>
      </TranslationProvider>
    </ConfigProvider>
  );
}

export default UiChatWidget;
