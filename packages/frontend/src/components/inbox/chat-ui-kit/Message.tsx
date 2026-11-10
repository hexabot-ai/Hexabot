/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import Box from "@mui/material/Box";
import { alpha, useTheme } from "@mui/material/styles";
import React, { ReactElement, ReactNode } from "react";

import { Avatar } from "./Avatar";
import { MessageCustomContent } from "./MessageCustomContent";
import { MessageFooter } from "./MessageFooter";
import {
  AvatarPosition,
  MessageDirection,
  MessageImageContentProps,
  MessagePayload,
  MessagePosition,
  MessageProps,
  MessageType,
} from "./types";

const AVATAR_SLOT_WIDTH = 42;
const AVATAR_SPACER_WIDTH = 50;

function getComponentName(element: ReactElement): string {
  if (typeof element.type === "string") return element.type;

  const typed = element.type as { displayName?: string; name?: string };

  return typed.displayName || typed.name || "";
}

function isAvatarElement(element: ReactElement): boolean {
  return element.type === Avatar || getComponentName(element) === "Avatar";
}

function isFooterElement(element: ReactElement): boolean {
  return (
    element.type === MessageFooter ||
    getComponentName(element) === "Message.Footer"
  );
}

function normalizeDirection(
  direction?: MessageDirection,
): "incoming" | "outgoing" {
  if (direction === "incoming" || direction === 0) {
    return "incoming";
  }

  return "outgoing";
}

function normalizePosition(
  position?: MessagePosition,
): Exclude<MessagePosition, 0 | 1 | 2 | 3> {
  if (position === 0 || position === "single") return "single";
  if (position === 1 || position === "first") return "first";
  if (position === 3 || position === "last") return "last";

  return "normal";
}

function getAvatarAlign(
  avatarPosition?: AvatarPosition,
): "flex-start" | "center" | "flex-end" {
  if (!avatarPosition) return "flex-end";

  if (
    avatarPosition === "tl" ||
    avatarPosition === "tr" ||
    avatarPosition === "top-left" ||
    avatarPosition === "top-right"
  ) {
    return "flex-start";
  }

  if (
    avatarPosition === "cl" ||
    avatarPosition === "cr" ||
    avatarPosition === "center-left" ||
    avatarPosition === "center-right"
  ) {
    return "center";
  }

  return "flex-end";
}

function getBorderRadius(
  direction: "incoming" | "outgoing",
  position: Exclude<MessagePosition, 0 | 1 | 2 | 3>,
  radius: number,
): string {
  const r = radius;

  if (direction === "incoming") {
    if (position === "single") return `0 ${r}px ${r}px ${r}px`;
    if (position === "first") return `0 ${r}px ${r}px 0`;
    if (position === "last") return `0 ${r}px 0 ${r}px`;

    return `0 ${r}px ${r}px 0`;
  }

  if (position === "single") return `${r}px ${r}px 0 ${r}px`;
  if (position === "first") return `${r}px 0 0 ${r}px`;
  if (position === "last") return `${r}px 0 ${r}px ${r}px`;

  return `${r}px 0 0 ${r}px`;
}

function renderFallbackContent(
  messageType: MessageType,
  resolvedPayload: MessagePayload | undefined,
): ReactNode {
  if (messageType === "custom" && React.isValidElement(resolvedPayload)) {
    return resolvedPayload;
  }

  if (messageType === "image") {
    if (React.isValidElement(resolvedPayload)) return resolvedPayload;

    const payload = resolvedPayload as MessageImageContentProps | undefined;

    return payload?.src ? (
      <Box
        component="img"
        src={payload.src}
        alt={payload.alt || ""}
        sx={{
          width:
            typeof payload.width === "number"
              ? `${payload.width}px`
              : payload.width,
          height:
            typeof payload.height === "number"
              ? `${payload.height}px`
              : payload.height,
          maxWidth: "100%",
          display: "block",
        }}
      />
    ) : null;
  }

  if (messageType === "html" && typeof resolvedPayload === "string") {
    return (
      <Box
        component="div"
        dangerouslySetInnerHTML={{ __html: resolvedPayload }}
        sx={{ whiteSpace: "normal" }}
      />
    );
  }

  if (React.isValidElement(resolvedPayload)) {
    return resolvedPayload;
  }

  if (typeof resolvedPayload === "string") {
    return resolvedPayload;
  }

  return null;
}

type MessageComponent = ((props: MessageProps) => React.JSX.Element) & {
  CustomContent: typeof MessageCustomContent;
  Footer: typeof MessageFooter;
};

function MessageBase({
  model,
  avatarSpacer = false,
  avatarPosition,
  type = "html",
  payload,
  children,
  className,
  ...rest
}: MessageProps) {
  const theme = useTheme();
  const {
    message = "",
    sentTime = "",
    sender = "",
    direction,
    position,
    type: modelType,
    payload: modelPayload,
  } = model || {
    direction: "outgoing",
    position: "single",
  };
  const normalizedDirection = normalizeDirection(direction);
  const normalizedPosition = normalizePosition(position);
  const displayMessageType = modelType || type;
  const resolvedPayload = (modelPayload ?? message ?? payload) as
    | MessagePayload
    | undefined;
  const childrenArray = React.Children.toArray(children).filter(
    React.isValidElement,
  ) as ReactElement[];

  let avatarElement: ReactElement | undefined;
  const footerElements: ReactElement[] = [];
  const contentElements: ReactNode[] = [];

  childrenArray.forEach((element) => {
    if (!avatarElement && isAvatarElement(element)) {
      avatarElement = element;

      return;
    }

    if (isFooterElement(element)) {
      footerElements.push(element);

      return;
    }

    contentElements.push(element);
  });

  const content =
    contentElements.length > 0
      ? contentElements
      : renderFallbackContent(displayMessageType, resolvedPayload);
  const isOutgoing = normalizedDirection === "outgoing";
  const darkIncomingBackground = theme.vars
    ? `rgba(${theme.vars.palette.text.primaryChannel} / 0.14)`
    : alpha(theme.palette.text.primary, 0.14);
  const baseBorderRadius =
    typeof theme.shape.borderRadius === "number"
      ? theme.shape.borderRadius + 4
      : 12;
  const borderRadius = getBorderRadius(
    normalizedDirection,
    normalizedPosition,
    baseBorderRadius,
  );
  const ariaLabel =
    sender && sentTime ? `${sender}: ${sentTime}` : sender || undefined;

  return (
    <Box
      component="section"
      aria-label={ariaLabel}
      className={className}
      sx={{
        display: "flex",
        flexDirection:
          normalizedDirection === "outgoing" ? "row-reverse" : "row",
        alignItems: "flex-end",
        width: "fit-content",
        maxWidth: { xs: "92%", sm: "85%" },
        mt: 2,
        ...(normalizedDirection === "incoming"
          ? { mr: "auto" }
          : { ml: "auto" }),
        ...(avatarSpacer
          ? normalizedDirection === "incoming"
            ? { ml: `${AVATAR_SPACER_WIDTH}px` }
            : { mr: `${AVATAR_SPACER_WIDTH}px` }
          : {}),
      }}
      {...rest}
    >
      {avatarElement && (
        <Box
          component="div"
          sx={{
            width: AVATAR_SLOT_WIDTH,
            display: "flex",
            justifyContent: getAvatarAlign(avatarPosition),
            ...(normalizedDirection === "incoming" ? { mr: 1 } : { ml: 1 }),
          }}
        >
          {avatarElement}
        </Box>
      )}
      <Box
        component="div"
        sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}
      >
        <Box
          component="div"
          sx={{
            ...(isOutgoing
              ? {
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                }
              : {
                  bgcolor: theme.palette.grey[100],
                  color: "text.primary",
                  ...theme.applyStyles("dark", {
                    bgcolor: darkIncomingBackground,
                  }),
                }),
            p: 2,
            borderRadius,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
            ...theme.typography.body2,
            lineHeight: 1.4,
          }}
        >
          {content}
        </Box>
        {footerElements}
      </Box>
    </Box>
  );
}

MessageBase.displayName = "Message";

export const Message = Object.assign(MessageBase, {
  CustomContent: MessageCustomContent,
  Footer: MessageFooter,
}) as MessageComponent;
