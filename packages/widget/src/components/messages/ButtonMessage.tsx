/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import React from "react";

import { useChat } from "../../providers/ChatProvider";
import { Button, UiMessage, Web } from "../../types/message.types";

import "./ButtonMessage.scss";

interface ButtonsMessageProps {
  message: UiMessage | { data: { buttons: Button[] } };
}

const ButtonsMessage: React.FC<ButtonsMessageProps> = ({ message }) => {
  const { send } = useChat();
  const handleClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    button: Button,
  ) => {
    if (button.type === "web_url" && button.url) {
      window.open(button.url, "_blank");
    } else if (button.type === "postback") {
      send({
        event,
        source: "post-back",
        data: {
          type: Web.InboundMessageType.postback,
          data: {
            text: button.title,
            payload: button.payload,
          },
        },
      });
    }
  };

  if (!("buttons" in message.data)) {
    throw new Error("Unable to find buttons");
  }
  if (
    !Array.isArray(message.data.buttons) ||
    message.data.buttons.length === 0
  ) {
    return null;
  }

  return (
    <div className="hb-message--buttons">
      {message.data.buttons.map((button, index) => (
        <button
          key={index}
          className="hb-message--buttons-content"
          onClick={(event) => handleClick(event, button)}
        >
          {button.title}
        </button>
      ))}
    </div>
  );
};

export default ButtonsMessage;
