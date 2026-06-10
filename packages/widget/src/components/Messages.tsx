/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import React, { PropsWithChildren, useEffect, useRef, useState } from "react";

import { useChat } from "../providers/ChatProvider";
import { useWidget } from "../providers/WidgetProvider";
import { UiMessage } from "../types/message.types";

import Message from "./Message";
import "./Messages.scss";
import TypingMessage from "./messages/TypingMessage";

type MessagesProps = PropsWithChildren<{
  Avatar?: () => JSX.Element;
}>;

const Messages: React.FC<MessagesProps> = ({ Avatar }) => {
  const { scroll, setScroll, isOpen } = useWidget();
  const { messages, newIOMessage, showTypingIndicator } = useChat();
  const scrollListRef = useRef<HTMLDivElement>(null);
  const [lastReceivedMessage, setLastReceivedMessage] = useState<
    UiMessage | undefined
  >();

  useEffect(() => {
    const scrollTo = (scroll: number) => {
      if (scrollListRef.current) {
        const scrollPercent = Math.round(
          (100 * scrollListRef.current.scrollTop) /
            (scrollListRef.current.scrollHeight || 1),
        );

        if (Math.abs(scrollPercent - scroll) > 1 || scroll === 100) {
          requestAnimationFrame(() => {
            if (scrollListRef.current) {
              scrollListRef.current.scrollTo({
                top: Math.round(
                  (scroll * scrollListRef.current.scrollHeight) / 100,
                ),
                behavior: "instant",
                left: 0,
              });
            }
          });
        }
      }
    };

    if (isOpen) {
      setTimeout(() => {
        scrollTo(scroll);
      }, 100);
    }
  }, [scroll, isOpen, messages.length]);

  useEffect(() => {
    const newestReceivedMessage = messages[messages.length - 1];

    if (lastReceivedMessage !== newestReceivedMessage) {
      setLastReceivedMessage(newestReceivedMessage);
      setScroll(100);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  return (
    <div
      className="hb-message-list nowheel"
      ref={scrollListRef}
      onWheelCapture={(event) => {
        event.stopPropagation();
      }}
      onTouchMoveCapture={(event) => {
        event.stopPropagation();
      }}
    >
      {messages.map((message) => (
        <Message
          key={message.mid}
          message={message}
          Avatar={Avatar}
          animate={message.mid === newIOMessage?.mid}
        />
      ))}
      {showTypingIndicator && <TypingMessage />}
    </div>
  );
};

export default Messages;
