/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import dayjs from "dayjs";
import "dayjs/locale/en";
import "dayjs/locale/fr";
import relativeTime from "dayjs/plugin/relativeTime";
import React, { PropsWithChildren, useState } from "react";

import { useChat } from "../providers/ChatProvider";
import { Direction, UiMessage, Web } from "../types/message.types";

import "./Message.scss";
import ButtonsMessage from "./messages/ButtonMessage";
import CarouselMessage from "./messages/CarouselMessage";
import FileMessage from "./messages/FileMessage";
import GeolocationMessage from "./messages/GeolocationMessage";
import ListMessage from "./messages/ListMessage";
import TextMessage from "./messages/TextMessage";
import MessageStatus from "./MessageStatus";

dayjs.extend(relativeTime);

type MessageProps = PropsWithChildren<{
  animate?: boolean;
  Avatar?: () => JSX.Element;
  message: UiMessage;
}>;

const Message: React.FC<MessageProps> = ({
  message,
  animate = false,
  Avatar,
}) => {
  const { participants } = useChat();
  const [isTimeVisible, setIsTimeVisible] = useState(false);
  const user = participants.find(
    (participant) => participant.id === message.author,
  ) || {
    id: "me",
    name: "Anon",
  };
  const handleTime = () => {
    setIsTimeVisible(!isTimeVisible);
  };
  const fromNow = (time: Date) => {
    return dayjs(time).fromNow();
  };
  const shouldShowAvatar =
    message.direction === Direction.received &&
    (Boolean(user.imageUrl) || Boolean(Avatar));
  const shouldTypewrite = animate && message.direction === Direction.received;

  return (
    <div
      className={`hb-message ${message.direction}${
        animate ? " hb-message--new" : ""
      }`}
    >
      <div
        className={`hb-message--content ${message.direction} ${
          shouldShowAvatar ? "with-avatar" : "no-avatar"
        }`}
      >
        {shouldShowAvatar && (
          <div
            title={user.name}
            className="hb-message--avatar"
            style={
              user.imageUrl
                ? {
                    backgroundImage: `url(${user.imageUrl})`,
                  }
                : undefined
            }
          >
            {Avatar ? <Avatar /> : null}
          </div>
        )}
        <div className="hb-message--wrapper" onClick={handleTime}>
          {message.data && "text" in message.data && (
            <TextMessage message={message} typewriter={shouldTypewrite} />
          )}
          {message.type === Web.InboundMessageType.file && (
            <FileMessage message={message} />
          )}
          {message.type === Web.InboundMessageType.location && (
            <GeolocationMessage message={message} />
          )}
          {message.type === Web.OutboundMessageType.list && (
            <ListMessage messageList={message} />
          )}
          {message.type === Web.OutboundMessageType.carousel && (
            <CarouselMessage messageCarousel={message} />
          )}
          {message.type === Web.OutboundMessageType.buttons && (
            <ButtonsMessage message={message} />
          )}

          <div className="hb-message--meta">
            {message.direction === "sent" && (
              <MessageStatus message={message} />
            )}
            <div className="hb-message--time">
              {isTimeVisible && fromNow(message.createdAt)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Message;
