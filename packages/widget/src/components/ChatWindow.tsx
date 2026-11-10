/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import React, {
  PropsWithChildren,
  type ReactElement,
  useEffect,
  useMemo,
} from "react";

import { subscribesSilently, useChat } from "../providers/ChatProvider";
import { useConfig } from "../providers/ConfigProvider";
import { useWidget } from "../providers/WidgetProvider";
import { ChatScreen, ConnectionState } from "../types/state.types";

import ChatHeader from "./ChatHeader";
import ConnectionLost from "./ConnectionLost";
import ErrorScreen from "./ErrorScreen";
import { LoadingComponent } from "./LoadingComponent";
import Messages from "./Messages";
import UserInput from "./UserInput";

import "./ChatWindow.scss";

type ChatWindowProps = PropsWithChildren<{
  CustomHeader?: () => ReactElement | null;
  CustomAvatar?: () => ReactElement;
  CustomComposer?: React.FC;
  PreChat?: React.FC;
  PostChat?: React.FC;
}>;

const ChatWindow: React.FC<ChatWindowProps> = ({
  CustomHeader,
  CustomAvatar,
  CustomComposer,
  PreChat,
  PostChat,
}) => {
  const { connectionState, messages, profile } = useChat();
  const { screen, isOpen, setScreen } = useWidget();
  const silentSubscription = subscribesSilently(useConfig());
  const ChatView = useMemo(
    () => (
      <>
        <Messages Avatar={CustomAvatar} />
        {CustomComposer ? <CustomComposer /> : <UserInput />}
      </>
    ),
    [CustomAvatar, CustomComposer],
  );

  useEffect(() => {
    if (
      !profile &&
      messages.length === 0 &&
      connectionState === ConnectionState.notConnectedYet
    ) {
      // Until the server settings trigger the silent subscription.
      setScreen(silentSubscription ? ChatScreen.LOADING : ChatScreen.PRE_CHAT);
    } else if (connectionState === ConnectionState.tryingToConnect) {
      setScreen(ChatScreen.LOADING);
    } else if (connectionState === ConnectionState.disconnected) {
      setScreen(ChatScreen.DISCONNECT);
    } else if (connectionState === ConnectionState.error) {
      setScreen(ChatScreen.ERROR);
    } else {
      setScreen(ChatScreen.CHAT);
    }
  }, [
    messages.length,
    connectionState,
    setScreen,
    profile,
    silentSubscription,
  ]);

  const getCurrentScreen = () => {
    switch (screen) {
      case ChatScreen.PRE_CHAT:
        return PreChat && <PreChat />;
      case ChatScreen.CHAT:
        return ChatView;
      case ChatScreen.POST_CHAT:
        return PostChat && <PostChat />;
      case ChatScreen.LOADING:
        return <LoadingComponent />;
      case ChatScreen.DISCONNECT:
        return <ConnectionLost />;
      case ChatScreen.ERROR:
        return <ErrorScreen />;
      default:
        return PreChat && <PreChat />;
    }
  };

  return (
    <div className={`hb-chat-window ${isOpen ? "opened" : "closed"}`}>
      {CustomHeader?.() === null ? null : CustomHeader ? (
        <ChatHeader>
          <CustomHeader />
        </ChatHeader>
      ) : (
        <ChatHeader />
      )}
      {getCurrentScreen()}
    </div>
  );
};

export default ChatWindow;
