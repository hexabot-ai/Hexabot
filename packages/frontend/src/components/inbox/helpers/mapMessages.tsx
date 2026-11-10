/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type {
  Message as MessageEntity,
  MessageFull,
  StdIncomingMessage,
  StdOutgoingMessage,
} from "@hexabot-ai/types";
import { IncomingMessageType, OutgoingMessageType } from "@hexabot-ai/types";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import { Theme, alpha } from "@mui/material/styles";
import Tooltip from "@mui/material/Tooltip";
import DOMPurify from "dompurify";
import { Menu, Reply } from "lucide-react";
import { marked } from "marked";
import React, { ReactNode } from "react";

import { ROUTES } from "@/services/api.class";
import { EntityType } from "@/services/types";
import { buildURL } from "@/utils/URL";

import { Message, MessageModel } from "../chat-ui-kit";
import { MessageAttachmentsViewer } from "../components/AttachmentViewer";
import { Carousel } from "../components/Carousel";
import GeolocationMessage from "../components/GeolocationMessage";

function isIncomingMessage(
  messageEntity: MessageEntity | MessageFull,
): boolean {
  return !messageEntity.recipient;
}

function isOutgoingMessage(
  messageEntity: MessageEntity | MessageFull,
): boolean {
  return Boolean(messageEntity.recipient);
}

function hasSameSender(
  m1: MessageEntity | MessageFull,
  m2: MessageEntity | MessageFull,
): boolean {
  const sender1 = typeof m1.sender === "string" ? m1.sender : m1.sender?.id;
  const sender2 = typeof m2.sender === "string" ? m2.sender : m2.sender?.id;

  return sender1 === sender2;
}

function hasSameRecipient(
  m1: MessageEntity | MessageFull,
  m2: MessageEntity | MessageFull,
): boolean {
  const recipient1 =
    typeof m1.recipient === "string" ? m1.recipient : m1.recipient?.id;
  const recipient2 =
    typeof m2.recipient === "string" ? m2.recipient : m2.recipient?.id;

  return recipient1 === recipient2;
}

/**
 * @description Two messages are concidered from the same source if they have equal properties of sender, sentBy and recipient.
 */
function isSubsequent(
  currMessage: MessageFull | MessageEntity | undefined,
  nextMessage: MessageFull | MessageEntity | undefined,
): boolean {
  if (!currMessage) return false;
  if (!nextMessage) return false;

  return (
    hasSameSender(currMessage, nextMessage) &&
    currMessage.sentBy === nextMessage.sentBy &&
    hasSameRecipient(currMessage, nextMessage)
  );
}

/**
 * @description Converts markdown to safe HTML for rendering in chat messages
 */
function formatMessageText(text: string, theme: Theme): ReactNode {
  try {
    const unsafeHtml = marked.parse(text, {
      gfm: true,
      breaks: true,
    });
    const safeHtml = DOMPurify.sanitize(
      typeof unsafeHtml === "string" ? unsafeHtml : text,
    );

    return (
      <Box
        component="div"
        dangerouslySetInnerHTML={{
          __html: safeHtml,
        }}
        sx={{
          whiteSpace: "normal",
          "& p": {
            margin: theme.spacing(0.5, 0),
          },
          "& p:first-of-type": {
            marginTop: 0,
          },
          "& p:last-of-type": {
            marginBottom: 0,
          },
          "& ul, & ol": {
            margin: theme.spacing(0.5, 0),
            paddingLeft: theme.spacing(2.5),
          },
          "& pre": {
            margin: theme.spacing(0.5, 0),
            padding: theme.spacing(0.5, 0.75),
            borderRadius: theme.shape.borderRadius,
            overflowX: "auto",
            backgroundColor: alpha(
              theme.palette.text.primary,
              theme.palette.mode === "dark" ? 0.2 : 0.08,
            ),
          },
          "& code": {
            fontSize: "0.9em",
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          },
          "& blockquote": {
            margin: theme.spacing(0.5, 0),
            paddingLeft: theme.spacing(1.5),
            borderLeft: `2px solid ${theme.palette.divider}`,
          },
          "& a": {
            color: "inherit",
            textDecoration: "underline",
            wordBreak: "break-word",
          },
          "& a:hover": {
            opacity: 0.8,
          },
        }}
      />
    );
  } catch (_error) {
    return (
      <Box
        component="div"
        sx={{
          whiteSpace: "normal",
        }}
      >
        {text}
      </Box>
    );
  }
}
/**
 * @description this function constructs the message children basen on message type
 */
export function getMessageContent(
  messageEntity: MessageFull | MessageEntity,
  theme: Theme,
  formattedTimestamp?: string,
  normalizedTimestamp?: string,
): ReactNode[] {
  const message = messageEntity.message;
  let content: ReactNode[] = [];
  const outgoingTimestampColor = theme.vars
    ? `rgba(${theme.vars.palette.primary.contrastTextChannel} / 0.75)`
    : alpha(theme.palette.primary.contrastText, 0.75);
  const incomingTimestampColor = theme.vars
    ? `rgba(${theme.vars.palette.text.primaryChannel} / 0.65)`
    : alpha(theme.palette.text.primary, 0.65);
  const wrapWithTooltip = (
    child: React.ReactElement,
    key: string,
  ): ReactNode => {
    if (!normalizedTimestamp) return child;

    return (
      <Tooltip
        key={key}
        title={normalizedTimestamp}
        arrow
        enterDelay={300}
        leaveDelay={150}
      >
        {child}
      </Tooltip>
    );
  };
  const renderTimestamp = (keySuffix: string) =>
    formattedTimestamp
      ? wrapWithTooltip(
          <Box
            component="span"
            key={`timestamp-${keySuffix}`}
            sx={{
              fontSize: theme.typography.pxToRem(10),
              marginTop: theme.spacing(0.75),
              userSelect: "none",
              float: messageEntity.recipient ? "right" : "left",
              color: messageEntity.recipient
                ? outgoingTimestampColor
                : incomingTimestampColor,
            }}
          >
            {formattedTimestamp}
          </Box>,
          `timestamp-${keySuffix}`,
        )
      : null;

  let chips: { title: string }[] = [];
  let chipsIcon: ReactNode | null = null;
  const normalizeChips = (items: unknown[]): { title: string }[] =>
    items.flatMap((item) => {
      const title =
        item &&
        typeof item === "object" &&
        "title" in item &&
        typeof (item as { title?: unknown }).title === "string"
          ? (item as { title: string }).title
          : undefined;

      return title ? [{ title }] : [];
    });

  if (isIncomingMessage(messageEntity)) {
    const incomingMessage = message as StdIncomingMessage;

    switch (incomingMessage.type) {
      case IncomingMessageType.location:
        content.push(
          <Message.CustomContent key={`location-${messageEntity.id}`}>
            <GeolocationMessage message={incomingMessage} />
            {renderTimestamp(`location-${messageEntity.id}`)}
          </Message.CustomContent>,
        );
        break;
      case IncomingMessageType.attachment:
        content.push(
          <Message.CustomContent key={`attachment-${messageEntity.id}`}>
            <MessageAttachmentsViewer message={incomingMessage} />
            {renderTimestamp(`attachment-${messageEntity.id}`)}
          </Message.CustomContent>,
        );
        break;
      case IncomingMessageType.text:
      case IncomingMessageType.postback:
      case IncomingMessageType.quickReply:
        content.push(
          <Message.CustomContent key={messageEntity.id}>
            {formatMessageText(incomingMessage.data.text, theme)}
            {renderTimestamp(messageEntity.id)}
          </Message.CustomContent>,
        );
        break;
      default:
        break;
    }
  }

  if (isOutgoingMessage(messageEntity)) {
    const outgoingMessage = message as StdOutgoingMessage;

    switch (outgoingMessage.type) {
      case OutgoingMessageType.text:
        content.push(
          <Message.CustomContent key={messageEntity.id}>
            {formatMessageText(outgoingMessage.data.text, theme)}
            {renderTimestamp(messageEntity.id)}
          </Message.CustomContent>,
        );
        break;
      case OutgoingMessageType.quickReply:
        content.push(
          <Message.CustomContent key={messageEntity.id}>
            {formatMessageText(outgoingMessage.data.text, theme)}
            {renderTimestamp(messageEntity.id)}
          </Message.CustomContent>,
        );
        chips = normalizeChips(outgoingMessage.data.quickReplies);
        chipsIcon = (
          <Box
            component="span"
            sx={{ display: "inline-flex", color: "text.disabled" }}
          >
            <Reply size={16} />
          </Box>
        );
        break;
      case OutgoingMessageType.buttons:
        content.push(
          <Message.CustomContent key={messageEntity.id}>
            {formatMessageText(outgoingMessage.data.text, theme)}
            {renderTimestamp(messageEntity.id)}
          </Message.CustomContent>,
        );
        chips = normalizeChips(outgoingMessage.data.buttons);
        chipsIcon = (
          <Box
            component="span"
            sx={{ display: "inline-flex", color: "text.disabled" }}
          >
            <Menu size={16} />
          </Box>
        );
        break;
      case OutgoingMessageType.attachment:
        content.push(
          <Message.CustomContent key={`attachment-${messageEntity.id}`}>
            <MessageAttachmentsViewer message={outgoingMessage} />
            {renderTimestamp(`attachment-${messageEntity.id}`)}
          </Message.CustomContent>,
        );
        chips = normalizeChips(outgoingMessage.data.quickReplies ?? []);
        chipsIcon = (
          <Box
            component="span"
            sx={{ display: "inline-flex", color: "text.disabled" }}
          >
            <Reply size={16} />
          </Box>
        );
        break;
      case OutgoingMessageType.list:
      case OutgoingMessageType.carousel:
        content.push(
          <Message.CustomContent key={`carousel-${messageEntity.id}`}>
            <Carousel message={outgoingMessage} />
            {renderTimestamp(`carousel-${messageEntity.id}`)}
          </Message.CustomContent>,
        );
        break;
      default:
        break;
    }
  }

  if (chips.length > 0 && chipsIcon) {
    content.push(
      <Message.Footer sx={{ mt: 0.75 }} key={`chips-${messageEntity.id}`}>
        <Stack
          direction="row"
          spacing={0.75}
          alignItems="center"
          useFlexGap
          flexWrap="wrap"
        >
          <Box
            component="span"
            sx={{ display: "inline-flex", alignItems: "center" }}
          >
            {chipsIcon}
          </Box>
          {chips.map((chip) => (
            <Chip size="small" key={chip.title} label={chip.title} />
          ))}
        </Stack>
      </Message.Footer>,
    );
  }

  return content;
}

/**
 * @description Returns the avatar of the subscriber
 */
export function getAvatarSrc(
  apiUrl: string,
  entity: EntityType.USER | EntityType.SUBSCRIBER,
  id?: string,
) {
  return buildURL(apiUrl, `${ROUTES[entity]}/${id || "bot"}/profile_pic`);
}

export function getMessagePosition(
  currentMessage: MessageFull | MessageEntity,
  previousMessage?: MessageFull | MessageEntity,
  nextMessage?: MessageFull | MessageEntity,
): MessageModel["position"] {
  // If there is no previous and no next message, it's a single message
  if (!previousMessage && !nextMessage) {
    return "single";
  }

  // If the previous message is from a different sender and the next message is from a different sender
  if (
    (!previousMessage || !isSubsequent(previousMessage, currentMessage)) &&
    (!nextMessage || !isSubsequent(currentMessage, nextMessage))
  ) {
    return "single";
  }

  // If the previous message is from a different sender and the next message is from the same sender, it's the first message
  if (
    (!previousMessage || !isSubsequent(previousMessage, currentMessage)) &&
    isSubsequent(currentMessage, nextMessage)
  ) {
    return "first";
  }

  // If the previous message is from the same sender and the next message is from the same sender, it's a normal message
  if (
    isSubsequent(previousMessage, currentMessage) &&
    isSubsequent(currentMessage, nextMessage)
  ) {
    return "normal";
  }

  // If the previous message is from the same sender and there's no next message or the next message is from a different sender, it's the last message
  if (
    isSubsequent(previousMessage, currentMessage) &&
    (!nextMessage || !isSubsequent(currentMessage, nextMessage))
  ) {
    return "last";
  }

  // Default case (should not reach here)
  return "single";
}
