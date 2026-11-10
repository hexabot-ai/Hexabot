/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { SocketIoClientError } from "../utils/SocketIoClientError";

export enum Direction {
  sent = "sent",
  received = "received",
}

export enum FileType {
  image = "image",
  video = "video",
  audio = "audio",
  file = "file",
  unknown = "unknown",
}

export enum ButtonType {
  postback = "postback",
  web_url = "web_url",
}

export type PostBackButton = {
  type: ButtonType.postback;
  title: string;
  payload: string;
};

export type WebUrlButton = {
  type: ButtonType.web_url;
  title: string;
  url: string;
};

export type Button = PostBackButton | WebUrlButton;

export type StdQuickReply = {
  title: string;
  payload: string;
};

export type SubscriberChannelData = {
  isSocket: boolean;
  ipAddress: string;
  agent: string;
};

export type SubscriberChannel =
  | SubscriberChannelData
  | {
      name: string | null;
      data?: Record<string, unknown> | null;
    };

export type SubscriberFull = {
  id: string;
  firstName: string;
  lastName: string;
  locale: string | null;
  gender: string | null;
  assignedAt?: Date | null;
  lastvisit?: Date | null;
  retainedFrom?: Date | null;
  channel: SubscriberChannel;
  timezone?: number;
  language: string;
  country?: string | null;
  foreignId: string;
};

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Web {
  export type RequestSession = {
    web?: {
      profile: SubscriberFull;
      threadId?: string;
    };
  };

  export enum StatusEventType {
    delivery = "delivery",
    read = "read",
    typing = "typing",
  }

  export enum InboundMessageType {
    text = "text",
    quick_reply = "quick_reply",
    postback = "postback",
    location = "location",
    file = "file",
  }

  export type EventType = Web.StatusEventType | Web.InboundMessageType;

  export enum OutboundMessageType {
    text = "text",
    buttons = "buttons",
    quick_replies = "quick_replies",
    file = "file",
    list = "list",
    carousel = "carousel",
  }

  export type InboundEventMetadata = {
    mid?: string;
    author?: string;
    thread_id?: string;
    read?: boolean;
    delivery?: boolean;
    // Whether it's a synchronization
    // This is used when message sent by the chatbot from the client side
    sync?: boolean;
    createdAt?: Date;
  };

  export type InboundTextMessageData = {
    text: string;
  };

  export type InboundPayloadMessageData = {
    text: string;
    payload: string;
  };

  export type InboundLocationMessageData = {
    coordinates: {
      lat: number;
      lng: number;
    };
  };

  export type InboundAttachmentHistoryMessageData = {
    type: FileType;
    url: string;
  };

  export type InboundAttachmentUploadMessageData = {
    type: string;
    size: number;
    name: string;
    file?: File;
  };

  export type InboundAttachmentMessageData =
    | InboundAttachmentHistoryMessageData
    | InboundAttachmentUploadMessageData;

  export type InboundMessageData =
    | InboundTextMessageData
    | InboundPayloadMessageData
    | InboundLocationMessageData
    | InboundAttachmentMessageData;

  export type StatusDeliveryEvent = {
    type: StatusEventType.delivery;
    mid: string;
  };

  export type StatusReadEvent = {
    type: StatusEventType.read;
    watermark: number;
  };

  export type StatusTypingEvent = {
    type: StatusEventType.typing;
  };

  export type StatusEvent =
    | StatusDeliveryEvent
    | StatusReadEvent
    | StatusTypingEvent;

  export type InboundTextMessage = {
    type: InboundMessageType.text;
    data: InboundTextMessageData;
  } & InboundEventMetadata;

  export type InboundPostbackMessage = {
    type: InboundMessageType.postback;
    data: InboundPayloadMessageData;
  } & InboundEventMetadata;

  export type InboundQuickReplyMessage = {
    type: InboundMessageType.quick_reply;
    data: InboundPayloadMessageData;
  } & InboundEventMetadata;

  export type InboundPayloadMessage =
    | InboundPostbackMessage
    | InboundQuickReplyMessage;

  export type InboundLocationMessage = {
    type: InboundMessageType.location;
    data: InboundLocationMessageData;
  } & InboundEventMetadata;

  export type InboundAttachmentMessage = {
    type: InboundMessageType.file;
    data: InboundAttachmentMessageData;
  } & InboundEventMetadata;

  export type InboundMessageBase =
    | InboundTextMessage
    | InboundPayloadMessage
    | InboundLocationMessage
    | InboundAttachmentMessage;

  export type InboundMessage<
    T extends InboundMessageBase = InboundMessageBase,
  > = T;

  export type Event = StatusEvent | InboundMessageBase;

  export interface MessageElement {
    title: string;
    subtitle?: string;
    image_url?: string;
    default_action?: Omit<WebUrlButton, "title">;
    buttons?: Button[];
  }

  export type OutboundTextMessageData = {
    text: string;
  };

  export type OutboundQuickRepliesMessageData = OutboundTextMessageData & {
    quick_replies: StdQuickReply[];
  };

  export type OutboundButtonsMessageData = OutboundTextMessageData & {
    buttons: Button[];
  };

  export type OutboundFileMessageData = {
    quick_replies?: StdQuickReply[];
    type: FileType;
    url: string;
  };

  export type OutboundCarouselMessageData = {
    elements: MessageElement[];
  };

  export type OutboundListMessageData = OutboundCarouselMessageData & {
    top_element_style?: "large" | "compact";
    buttons: Button[];
  };

  export type OutboundMessageData =
    | OutboundTextMessageData
    | OutboundQuickRepliesMessageData
    | OutboundButtonsMessageData
    | OutboundFileMessageData
    | OutboundCarouselMessageData
    | OutboundListMessageData;

  export type OutboundMessageBase =
    | {
        type: OutboundMessageType.text;
        data: OutboundTextMessageData;
      }
    | {
        type: OutboundMessageType.quick_replies;
        data: OutboundQuickRepliesMessageData;
      }
    | {
        type: OutboundMessageType.buttons;
        data: OutboundButtonsMessageData;
      }
    | {
        type: OutboundMessageType.file;
        data: OutboundFileMessageData;
      }
    | {
        type: OutboundMessageType.carousel;
        data: OutboundCarouselMessageData;
      }
    | {
        type: OutboundMessageType.list;
        data: OutboundListMessageData;
      };

  export type OutboundMessage = OutboundMessageBase & {
    mid: string;
    author: string;
    thread_id?: string;
    read?: boolean;
    createdAt: Date;
    handover: boolean;
  };

  export type Message = OutboundMessage | InboundMessage;
}

export type Suggestion = {
  text: string;
  payload: string;
};

export type UiMessage = Omit<
  Web.Message,
  "mid" | "author" | "read" | "delivery" | "createdAt"
> & {
  mid: string;
  author: string;
  read?: boolean;
  delivery?: boolean;
  createdAt: Date;
  direction: Direction;
};

export type PostMessageEvent<
  T extends Web.InboundMessageBase = Web.InboundMessageBase,
> = T & {
  author?: string;
  thread_id?: string;
};

export interface SubscribeResponse {
  messages: Web.Message[];
  profile: SubscriberFull;
  thread_id: string | null;
}

export interface SocketErrorResponse {
  message: string;
  statusCode: number;
}

export type SocketErrorHandlers = Record<
  string,
  (err: SocketIoClientError) => Promise<void> | void
>;
