/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import DOMPurify from "dompurify";
import { marked } from "marked";
import React, { useMemo } from "react";

import { useTypewriter } from "../../hooks/useTypewriter";
import { Direction, UiMessage } from "../../types/message.types";

import "./TextMessage.scss";

interface TextMessageProps {
  message: UiMessage;
  typewriter?: boolean;
}

const TextMessage: React.FC<TextMessageProps> = ({
  message,
  typewriter = false,
}) => {
  if (!("text" in message.data)) {
    throw new Error("Unable to find text.");
  }
  const text = message.data.text;
  const shouldTypewrite =
    typewriter && message.direction === Direction.received;
  const { isTypewriting, visibleText } = useTypewriter(text, {
    enabled: shouldTypewrite,
  });
  const safeHtml = useMemo(() => {
    if (message.direction !== Direction.received) {
      return "";
    }

    try {
      const unsafeHtml = marked.parse(text, {
        gfm: true,
        breaks: true,
      });

      return DOMPurify.sanitize(
        typeof unsafeHtml === "string" ? unsafeHtml : text,
      );
    } catch (_error) {
      return DOMPurify.sanitize(text);
    }
  }, [message.direction, text]);

  return (
    <div className="hb-message--text">
      {message.direction === Direction.received ? (
        isTypewriting ? (
          <p className="hb-message--text-content plain typewriter">
            {visibleText}
          </p>
        ) : (
          <div
            className="hb-message--text-content markdown"
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        )
      ) : (
        <p className="hb-message--text-content plain">{text}</p>
      )}
    </div>
  );
};

export default TextMessage;
