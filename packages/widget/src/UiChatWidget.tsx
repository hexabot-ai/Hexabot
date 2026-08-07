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
import "./UiChatWidget.css";

type UiChatWidgetProps = PropsWithChildren<{
  CustomLauncher?: (props: { widget: WidgetContextType }) => ReactElement;
  CustomHeader?: () => ReactElement | null;
  CustomAvatar?: () => ReactElement;
  PreChat?: React.FC;
  PostChat?: React.FC;
  defaultIsOpen?: boolean;
  config: Partial<Config>;
  socketErrorHandlers?: SocketErrorHandlers;
}>;

function UiChatWidget({
  CustomHeader,
  CustomAvatar,
  CustomLauncher,
  config,
  defaultIsOpen,
  socketErrorHandlers,
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
                      PreChat={UserSubscription}
                    />
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
