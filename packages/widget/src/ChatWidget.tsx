/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import "./theme/normalize.scss";
import Launcher from "./components/Launcher";
import UserSubscription from "./components/UserSubscription";
import BroadcastChannelProvider from "./providers/BroadcastChannelProvider";
import ChatProvider from "./providers/ChatProvider";
import { ConfigProvider } from "./providers/ConfigProvider";
import { SettingsProvider } from "./providers/SettingsProvider";
import { SocketProvider } from "./providers/SocketProvider";
import { ThemeProvider } from "./providers/ThemeProvider";
import { TranslationProvider } from "./providers/TranslationProvider";
import WidgetProvider from "./providers/WidgetProvider";
import { Config } from "./types/config.types";

function ChatWidget(props: Partial<Config>) {
  return (
    <ConfigProvider {...props}>
      <TranslationProvider>
        <SocketProvider
          socketErrorHandlers={{
            "401": (err) => {
              err.socket.forceReconnect();
            },
          }}
        >
          <SettingsProvider>
            <ThemeProvider>
              <WidgetProvider>
                <BroadcastChannelProvider channelName="main-channel">
                  <ChatProvider>
                    <Launcher PreChat={UserSubscription} />
                  </ChatProvider>
                </BroadcastChannelProvider>
              </WidgetProvider>
            </ThemeProvider>
          </SettingsProvider>
        </SocketProvider>
      </TranslationProvider>
    </ConfigProvider>
  );
}

export default ChatWidget;
