/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import AttachFileRoundedIcon from "@mui/icons-material/AttachFileRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { MessageInputProps, MessageInputRef } from "./types";

function placeCaretAtEnd(element: HTMLElement): void {
  if (typeof window === "undefined") return;

  const selection = window.getSelection();

  if (!selection) return;

  const range = document.createRange();

  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function cloneNodes(element: HTMLElement): NodeList {
  return (element.cloneNode(true) as HTMLElement).childNodes;
}

export const MessageInput = forwardRef<MessageInputRef, MessageInputProps>(
  function MessageInput(
    {
      value,
      onSend,
      onChange,
      autoFocus = false,
      placeholder = "",
      fancyScroll = true,
      className,
      activateAfterChange = false,
      disabled = false,
      sendDisabled,
      sendOnReturnDisabled = false,
      attachDisabled = false,
      sendButton = true,
      attachButton = true,
      onAttachClick,
      ...rest
    },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const isControlled = typeof value === "string";
    const [internalValue, setInternalValue] = useState(value || "");
    const [computedSendDisabled, setComputedSendDisabled] = useState(
      typeof sendDisabled === "boolean" ? sendDisabled : true,
    );
    const currentValue = isControlled ? value || "" : internalValue;
    const effectiveSendDisabled =
      disabled ||
      (typeof sendDisabled === "boolean" ? sendDisabled : computedSendDisabled);
    const focus = useCallback(() => {
      editorRef.current?.focus();
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focus,
      }),
      [focus],
    );

    useEffect(() => {
      if (autoFocus) {
        focus();
      }
    }, [autoFocus, focus]);

    useEffect(() => {
      const editor = editorRef.current;

      if (!editor) return;

      if (editor.innerHTML !== currentValue) {
        editor.innerHTML = currentValue;

        if (activateAfterChange) {
          placeCaretAtEnd(editor);
        }
      }

      if (typeof sendDisabled === "undefined") {
        setComputedSendDisabled((editor.textContent || "").length === 0);
      }
    }, [activateAfterChange, currentValue, sendDisabled]);

    const emitChange = useCallback(() => {
      const editor = editorRef.current;

      if (!editor) return;

      const innerHtml = editor.innerHTML;
      const textContent = editor.textContent || "";
      const innerText = editor.innerText || textContent;

      if (!isControlled) {
        setInternalValue(innerHtml);
      }

      if (typeof sendDisabled === "undefined") {
        setComputedSendDisabled(textContent.length === 0);
      }

      onChange?.(innerHtml, textContent, innerText, cloneNodes(editor));
    }, [isControlled, onChange, sendDisabled]);
    const send = useCallback(() => {
      const editor = editorRef.current;

      if (!editor) return;

      const innerHtml = isControlled ? currentValue : editor.innerHTML;
      const textContent = editor.textContent || "";
      const innerText = editor.innerText || textContent;

      if (textContent.length === 0) {
        return;
      }

      onSend?.(innerHtml, textContent, innerText, cloneNodes(editor));

      if (!isControlled) {
        setInternalValue("");
        editor.innerHTML = "";
      }

      if (typeof sendDisabled === "undefined") {
        setComputedSendDisabled(true);
      }
    }, [currentValue, isControlled, onSend, sendDisabled]);

    return (
      <Box
        className={className}
        sx={{
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 1,
          px: 1,
          py: 1,
          borderTop: (theme) => `1px solid ${theme.palette.divider}`,
          bgcolor: "background.paper",
          flexShrink: 0,
        }}
        {...rest}
      >
        {attachButton && (
          <Box sx={{ display: "flex", alignItems: "flex-end" }}>
            <IconButton
              size="small"
              disabled={disabled || attachDisabled}
              onClick={onAttachClick}
            >
              <AttachFileRoundedIcon />
            </IconButton>
          </Box>
        )}

        <Box
          sx={{
            flexGrow: 1,
            bgcolor: disabled ? "action.disabledBackground" : "action.hover",
            border: (theme) => `1px solid ${theme.palette.divider}`,
            borderRadius: 1.5,
            px: 1.25,
            py: 0.75,
          }}
        >
          <Box
            sx={{
              maxHeight: fancyScroll ? 88 : "none",
              overflowY: "auto",
            }}
          >
            <Box
              ref={editorRef}
              component="div"
              role="textbox"
              aria-multiline="true"
              aria-disabled={disabled}
              contentEditable={!disabled}
              suppressContentEditableWarning
              data-placeholder={
                typeof placeholder === "string" ? placeholder : ""
              }
              onInput={emitChange}
              onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !sendOnReturnDisabled
                ) {
                  event.preventDefault();
                  send();
                }
              }}
              sx={{
                typography: "body2",
                minHeight: "1.4em",
                lineHeight: 1.4,
                outline: 0,
                border: 0,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                wordBreak: "break-word",
                color: disabled ? "text.disabled" : "text.primary",
                "&:empty:before": {
                  content: "attr(data-placeholder)",
                  color: "text.disabled",
                  display: "block",
                  cursor: "text",
                },
              }}
            />
          </Box>
        </Box>

        {sendButton && (
          <Box sx={{ display: "flex", alignItems: "flex-end" }}>
            <IconButton
              size="small"
              disabled={effectiveSendDisabled}
              onClick={send}
            >
              <SendRoundedIcon />
            </IconButton>
          </Box>
        )}
      </Box>
    );
  },
);

MessageInput.displayName = "MessageInput";
