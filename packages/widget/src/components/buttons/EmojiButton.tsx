/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Smile } from "lucide-react";
import React, { RefObject, useRef, useState } from "react";

import EmojiPicker from "../EmojiPicker";

const EmojiButton: React.FC<{
  // React 19 types: `useRef<T>(null)` yields `RefObject<T | null>`.
  inputRef: RefObject<HTMLDivElement | null>;
  onInput: () => void;
}> = ({ inputRef, onInput }) => {
  const [isActive, setIsActive] = useState(false);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const togglePicker = () => {
    setIsActive(!isActive);
  };
  const handleBlur = (e: React.FocusEvent) => {
    if (!e.relatedTarget || e.relatedTarget !== emojiButtonRef.current) {
      togglePicker();
    }
  };
  const handleSelect = (
    _event: React.MouseEvent<HTMLSpanElement>,
    emoji: string,
  ) => {
    insertEmoji(emoji);
  };
  const insertEmoji = (emoji: string) => {
    if (inputRef.current) {
      const textNode = document.createTextNode(emoji);

      inputRef.current.appendChild(textNode);

      // Place the cursor after the emoji
      const range = document.createRange();
      const sel = window.getSelection();

      range.setStartAfter(textNode);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);

      onInput(); // Call to update the onChange handler
    }
  };

  return (
    <div className="hb-user-input--picker-wrapper">
      {isActive && <EmojiPicker onBlur={handleBlur} onSelect={handleSelect} />}
      <button
        onClick={(e) => {
          e.preventDefault();
          togglePicker();
        }}
        id="hb-emoji-button"
        className="hb-user-input--emoji-icon-wrapper"
        ref={emojiButtonRef}
      >
        <Smile className="hb-user-input--emoji-icon" />
      </button>
    </div>
  );
};

export default EmojiButton;
