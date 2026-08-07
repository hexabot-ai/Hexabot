/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { MessageCircle, X } from "lucide-react";
import React, { PropsWithChildren, type ReactElement } from "react";

import { useChat } from "../providers/ChatProvider";
import { useSocketLifecycle } from "../providers/SocketProvider";
import { useWidget, WidgetContextType } from "../providers/WidgetProvider";

import ChatWindow from "./ChatWindow";

import "./Launcher.scss";

type LauncherProps = PropsWithChildren<{
  CustomLauncher?: (props: { widget: WidgetContextType }) => ReactElement;
  CustomHeader?: () => ReactElement | null;
  CustomAvatar?: () => ReactElement;
  PreChat?: React.FC;
  PostChat?: React.FC;
}>;

const Launcher: React.FC<LauncherProps> = ({
  CustomLauncher,
  CustomHeader,
  CustomAvatar,
  PreChat,
  PostChat,
}) => {
  const chat = useChat();
  const widget = useWidget();
  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    widget.setIsOpen(!widget.isOpen);
  };

  useSocketLifecycle();

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        className={`hb-launcher-wrapper ${widget.isOpen ? "opened" : ""}`}
        onClick={handleToggle}
      >
        {CustomLauncher ? (
          <CustomLauncher widget={widget} />
        ) : (
          <div className="hb-launcher">
            {chat.newMessagesCount > 0 && !widget.isOpen && (
              <div className="hb-new-messages-count">
                {chat.newMessagesCount}
              </div>
            )}
            {widget.isOpen ? (
              <X className="hb-closed-icon" width="16px" height="16px" />
            ) : (
              <MessageCircle
                className="hb-open-icon"
                width="18px"
                height="18px"
              />
            )}
          </div>
        )}
      </div>
      {widget.isOpen && (
        <ChatWindow
          CustomHeader={CustomHeader}
          CustomAvatar={CustomAvatar}
          PreChat={PreChat}
          PostChat={PostChat}
        />
      )}
    </div>
  );
};

export default Launcher;
