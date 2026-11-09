/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Paperclip, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

import { useTranslation } from "../hooks/useTranslation";
import { useChat } from "../providers/ChatProvider";
import { useConfig } from "../providers/ConfigProvider";
import { useSettings } from "../providers/SettingsProvider";
import { Web } from "../types/message.types";
import { OutgoingMessageState } from "../types/state.types";
import { getFileError } from "../utils/attachment";

import EmojiButton from "./buttons/EmojiButton";
import FileButton from "./buttons/FileButton";
import LocationButton from "./buttons/LocationButton";
import MenuButton from "./buttons/MenuButton";
import SendButton from "./buttons/SendButton";
import Suggestions from "./Suggestions";

import "./UserInput.scss";

const UserInput: React.FC = () => {
  const { maxUploadSize } = useConfig();
  const { t } = useTranslation();
  const {
    suggestions,
    message,
    setMessage,
    file,
    setFile,
    send,
    outgoingMessageState,
  } = useChat();
  const {
    menu,
    focusOnOpen,
    autoFlush,
    allowedUploadTypes,
    showEmoji,
    showLocation,
    showFile,
    placeholder,
  } = useSettings();
  const userInputRef = useRef<HTMLDivElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [inputActive, setInputActive] = useState(false);

  useEffect(() => {
    if (focusOnOpen) {
      focusUserInput();
    }
  }, [focusOnOpen]);

  useEffect(() => {
    if (message === "") {
      userInputRef.current!.innerHTML = "";
    }
  }, [message]);

  useEffect(() => {
    setFileError(null);
  }, [file]);

  const cancelFile = () => {
    setFile(null);
    setFileError(null);
  };
  const handleInput = () => {
    setMessage(
      userInputRef.current?.innerText ||
        userInputRef.current?.textContent ||
        "",
    );
  };
  const sendMessage = (
    event: React.MouseEvent | React.KeyboardEvent,
    source: string = "send-button",
  ) => {
    if (message) {
      send({
        event,
        source,
        data: {
          type: Web.InboundMessageType.text,
          data: { text: message },
        },
      });
      if (autoFlush) {
        setMessage("");
      }
    }
    if (file) {
      setFileError(null);
      const error = getFileError(file, allowedUploadTypes, maxUploadSize);

      if (error) {
        setFileError(t(error));
      } else {
        send({
          event,
          source,
          data: {
            type: Web.InboundMessageType.file,
            data: {
              name: file.name,
              size: file.size,
              type: file.type,
              file,
            },
          },
        });
        autoFlush && setFile(null);
      }
    }
  };
  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      sendMessage(event, "enter-key");
      event.preventDefault();
    }
  };
  const focusUserInput = () => {
    userInputRef.current?.focus();
  };
  const uploading = outgoingMessageState === OutgoingMessageState.uploading;

  return (
    <div className="hb-user-input-wrapper">
      {suggestions.length > 0 && <Suggestions />}

      {(file || uploading) && (
        <div className="hb-file-container">
          <Paperclip width="16px" height="16px" className="icon-file-message" />
          {fileError && <span>{fileError}</span>}
          {uploading && <span>Loading...</span>}
          {file && file.name && !fileError && (
            <span>
              {file.name.length > 23
                ? `${file.name.substring(0, 23)}...`
                : file.name}
            </span>
          )}
          <span className="delete-file-message" onClick={cancelFile}>
            <X height="10" />
          </span>
        </div>
      )}

      <form className={`hb-user-input ${inputActive ? "active" : ""}`}>
        {menu.length > 0 && <MenuButton />}
        <div
          role="textbox"
          tabIndex={0}
          onFocus={() => setInputActive(true)}
          onBlur={() => setInputActive(false)}
          onKeyDown={handleKey}
          onInput={handleInput}
          onPaste={async (e) => {
            e.preventDefault();

            const text = await navigator.clipboard.readText();
            const range = window.getSelection()?.getRangeAt(0);

            if (range && text) {
              const node = document.createTextNode(text);

              range.deleteContents();
              range.insertNode(node);
              range.collapse(false);
            }

            handleInput();
          }}
          contentEditable
          suppressContentEditableWarning={true}
          spellCheck
          aria-autocomplete="list"
          // @ts-expect-error to check
          placeholder={placeholder} // Adjust for localization
          className="hb-user-input--text"
          ref={userInputRef}
        />
        <div className="hb-user-input--buttons">
          {showEmoji && (
            <div className="hb-user-input--button">
              <EmojiButton inputRef={userInputRef} onInput={handleInput} />
            </div>
          )}
          {showLocation && (
            <div className="hb-user-input--button">
              <LocationButton />
            </div>
          )}
          {showFile && (
            <div className="hb-user-input--button">
              <FileButton />
            </div>
          )}
          <div className="hb-user-input--button">
            <SendButton
              disabled={!message && !file}
              onClick={(event) => sendMessage(event)}
            />
          </div>
        </div>
      </form>
    </div>
  );
};

export default UserInput;
