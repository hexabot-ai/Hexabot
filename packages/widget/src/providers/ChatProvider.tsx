/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import React, {
  createContext,
  ReactNode,
  SyntheticEvent,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { useSubscribeBroadcastChannel } from "../hooks/useSubscribeBroadcastChannel";
import { useTranslation } from "../hooks/useTranslation";
import { StdEventType } from "../types/chat-io-messages.types";
import { Config } from "../types/config.types";
import {
  Direction,
  PostMessageEvent,
  SocketErrorHandlers,
  SocketErrorResponse,
  SubscribeResponse,
  Suggestion,
  SubscriberFull,
  UiMessage,
  Web,
} from "../types/message.types";
import { ConnectionState, OutgoingMessageState } from "../types/state.types";
import { SocketIoClientError } from "../utils/SocketIoClientError";
import { buildWebhookUrl, rebaseDownloadUrls } from "../utils/webhook-url";

import { useBroadcastChannel } from "./BroadcastChannelProvider";
import { useConfig } from "./ConfigProvider";
import { ChannelSettings, useSettings } from "./SettingsProvider";
import { useSocket, useSubscribe } from "./SocketProvider";
import { useWidget } from "./WidgetProvider";

const normalizeDate = (value: unknown): Date => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  return new Date();
};
const normalizeMessageIdentity = (message: Web.Message) => {
  const candidate = message as {
    mid?: unknown;
    author?: unknown;
    createdAt?: unknown;
  };

  return {
    mid:
      typeof candidate.mid === "string" && candidate.mid.length > 0
        ? candidate.mid
        : `widget-${Date.now()}`,
    author:
      typeof candidate.author === "string" && candidate.author.length > 0
        ? candidate.author
        : "chatbot",
    createdAt: normalizeDate(candidate.createdAt),
  };
};
const toUiMessage = (
  message: Web.Message,
  profile: SubscriberFull | undefined,
  apiUrl: string,
): UiMessage => {
  const normalized = normalizeMessageIdentity(message);
  const isSentByProfile =
    normalized.author === profile?.foreignId ||
    normalized.author === profile?.id;
  const direction = isSentByProfile ? Direction.sent : Direction.received;
  const status = message as {
    read?: unknown;
    delivery?: unknown;
  };

  return {
    ...rebaseDownloadUrls(message, apiUrl),
    ...normalized,
    direction,
    read: direction === Direction.sent || status.read === true,
    delivery: direction === Direction.sent || status.delivery === true,
  };
};

/**
 * Whether a visitor without a session is subscribed without the pre-chat
 * form: always on the admin console, and when the host passes a profile.
 */
export const subscribesSilently = ({ channel, profile }: Config) =>
  channel === "console" || !!profile;

export const getQuickReplies = (message?: UiMessage): Suggestion[] =>
  message && "data" in message && "quick_replies" in message.data
    ? (message.data.quick_replies || []).map((quickReply) => ({
        text: quickReply.title,
        payload: quickReply.payload,
      }))
    : [];

export const preprocessMessages = (
  messages: Web.Message[],
  participants: Participant[],
  profile: SubscriberFull | undefined,
  apiUrl: string,
) => {
  const arrangedMessages = messages.map((message) =>
    toUiMessage(message, profile, apiUrl),
  );
  const quickReplies = getQuickReplies(
    arrangedMessages[arrangedMessages.length - 1],
  );
  const participantsList: Participant[] = profile
    ? [
        participants[0],
        {
          id: profile.foreignId,
          foreign_id: profile.foreignId,
          name: `${profile.firstName} ${profile.lastName}`,
        },
      ]
    : [participants[0]];

  return {
    quickReplies,
    arrangedMessages,
    participantsList,
  };
};

interface Participant {
  id: string;
  name: string;
  foreign_id?: string;
  imageUrl?: string;
}
interface ChatContextType {
  /**
   * List of participants involved in the chat.
   */
  participants: Participant[];
  setParticipants: (participants: Participant[]) => void;

  /**
   * Represents the state of an outgoing message.
   * 0 = sent
   * 1 = sending
   * 2 = uploading
   */
  outgoingMessageState: OutgoingMessageState;
  setOutgoingMessageState: (state: OutgoingMessageState) => void;

  /**
   * Represents the connection state of the chat.
   * -1 = Disconnected
   * 0 = Not connected yet
   * 1 = Want to connect
   * 2 = Trying to connect
   * 3 = Connected
   */
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;

  /**
   * Array of messages exchanged in the chat.
   */
  messages: UiMessage[];
  setMessages: (messages: UiMessage[]) => void;

  /**
   * List of suggestions available in the chat context.
   */
  suggestions: Suggestion[];
  setSuggestions: (suggestions: Suggestion[]) => void;

  /**
   * Indicator of whether typing indicators are visible.
   */
  showTypingIndicator: boolean;
  setShowTypingIndicator: (show: boolean) => void;

  /**
   * The latest new IO (coming from websocket) message event or null if none.
   */
  newIOMessage: UiMessage | null;
  setNewIOMessage: (IOMessage: UiMessage | null) => void;

  /**
   * The count of new messages since the last read. This is mainly used to show a badge on the chat icon.
   */
  newMessagesCount: number;
  setNewMessagesCount: (count: number) => void;

  /**
   * The current message being composed.
   */
  message: string;
  setMessage: (message: string) => void;

  /**
   * The file attached to the message, if any.
   */
  file: File | null;
  setFile: (f: File | null) => void;

  /**
   * Function to send a message or event in the chat.
   * @param event - The synthetic event triggering the send action.
   * @param source - The source of the message.
   * @param data - The data associated with the message or event.
   */
  send: ({
    event,
    source,
    data,
  }: {
    event?: SyntheticEvent;
    source?: string;
    data: PostMessageEvent;
  }) => Promise<void>;

  /**
   * Function called to trigger a get request to subscribe :
   * 1. Send user informations (firstname and lastname)
   * 2. Get messaging history and the full subscriber object
   * @param firstName
   * @param lastName
   */
  handleSubscription: (firstName?: string, lastName?: string) => Promise<void>;
  profile?: SubscriberFull;
  subscribe: (
    first_name?: string,
    last_name?: string,
  ) => Promise<SubscribeResponse>;
  sendGetStarted: (foreign_id: string) => Promise<void>;
}

const defaultCtx: ChatContextType = {
  participants: [
    {
      id: "chatbot",
      name: "Hexabot",
      foreign_id: "chatbot",
      imageUrl: "",
    },
  ],
  setParticipants: () => {},
  outgoingMessageState: 0,
  setOutgoingMessageState: () => {},
  connectionState: 0,
  setConnectionState: () => {},
  messages: [],
  setMessages: () => {},
  suggestions: [],
  setSuggestions: () => {},
  showTypingIndicator: false,
  setShowTypingIndicator: () => {},
  newIOMessage: null,
  setNewIOMessage: () => {},
  newMessagesCount: 0,
  setNewMessagesCount: () => {},
  message: "",
  setMessage: () => {},
  file: null,
  setFile: () => {},
  send: async () => {},
  handleSubscription: async () => {},
  profile: undefined,
  subscribe: async () => {
    throw new Error("ChatProvider.subscribe is not available outside provider");
  },
  sendGetStarted: async () => {
    throw new Error(
      "ChatProvider.sendGetStarted is not available outside provider",
    );
  },
};
const ChatContext = createContext<ChatContextType | undefined>(undefined);
const ChatProvider: React.FC<{
  wantToConnect?: () => void;
  defaultConnectionState?: ConnectionState;
  children: ReactNode;
  socketErrorHandlers?: SocketErrorHandlers;
}> = ({ wantToConnect, defaultConnectionState = 0, children }) => {
  const { postMessage } = useBroadcastChannel();
  const config = useConfig();
  const settings = useSettings();
  const { setScroll, syncState, isOpen } = useWidget();
  const { socket, socketErrorHandlers } = useSocket();
  const { t } = useTranslation();
  const [participants, setParticipants] = useState<Participant[]>(
    defaultCtx.participants,
  );
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    defaultConnectionState,
  );
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [newMessagesCount, updateNewMessagesCount] = useState<number>(
    defaultCtx.newMessagesCount,
  );
  const [showTypingIndicator, setShowTypingIndicator] = useState(
    defaultCtx.showTypingIndicator,
  );
  const [suggestions, setSuggestions] = useState<Suggestion[]>(
    defaultCtx.suggestions,
  );
  const [newIOMessage, setNewIOMessage] = useState<UiMessage | null>(
    defaultCtx.newIOMessage,
  );
  const [message, setMessage] = useState<string>(defaultCtx.message);
  const [outgoingMessageState, setOutgoingMessageState] =
    useState<OutgoingMessageState>(defaultCtx.outgoingMessageState);
  const [file, setFile] = useState<File | null>(defaultCtx.file);
  const [profile, setProfile] = useState<undefined | SubscriberFull>();
  const getWebhookUrl = useCallback(
    (query?: URLSearchParams | Record<string, string>) =>
      buildWebhookUrl({
        sourceId: config.sourceId,
        workflowId: config.workflowId,
        query,
      }),
    [config.sourceId, config.workflowId],
  );
  const updateConnectionState = (state: ConnectionState) => {
    setConnectionState(state);
    state === ConnectionState.wantToConnect && wantToConnect && wantToConnect();
    state === ConnectionState.connected &&
      settings.alwaysScrollToBottom &&
      setScroll(101);
  };
  const handleNewIOMessage = (newMessage: Web.OutboundMessage | null) => {
    if (!newMessage) {
      return;
    }

    const normalizedMessage = toUiMessage(newMessage, profile, config.apiUrl);

    setNewIOMessage(normalizedMessage);
    setShowTypingIndicator(false);

    const isNew = !messages.some((msg) => normalizedMessage.mid === msg.mid);

    if (isNew) {
      if (!isOpen && normalizedMessage.direction === Direction.received) {
        updateNewMessagesCount((prevMessagesCount) => prevMessagesCount + 1);
      }

      setMessages((prevMessages) => [
        ...prevMessages.filter((msg) => msg.mid !== normalizedMessage.mid),
        normalizedMessage,
      ]);
      setScroll(0);
    }

    const quickReplies = getQuickReplies(normalizedMessage);

    setSuggestions(quickReplies);

    settings.alwaysScrollToBottom && setScroll(101); // @hack
    setOutgoingMessageState(OutgoingMessageState.sent);

    // Last, so a throwing host callback cannot leave the state half-updated.
    if (isNew) {
      config.onMessage?.(normalizedMessage);
    }
  };
  const handleSend = async ({
    data,
  }: {
    event?: SyntheticEvent;
    source?: string;
    data: PostMessageEvent;
  }) => {
    setOutgoingMessageState(
      data.type === Web.InboundMessageType.file
        ? OutgoingMessageState.uploading
        : OutgoingMessageState.sending,
    );
    setMessage("");
    try {
      // when the request timeout it throws exception & break frontend
      await socket.post<Web.Message>(getWebhookUrl(), {
        data: {
          ...data,
          author: data.author ?? participants[1]?.id,
        },
      });
    } catch (error) {
      if (
        error instanceof SocketIoClientError &&
        socketErrorHandlers?.[error.statusCode]
      ) {
        socketErrorHandlers[error.statusCode](error);
      } else {
        setConnectionState(ConnectionState.error);
        // eslint-disable-next-line no-console
        console.error("Unable to send message", error);
      }
    }
  };
  const requestSubscription = useCallback(
    async (firstName?: string, lastName?: string) => {
      try {
        setConnectionState(ConnectionState.tryingToConnect);
        // The API defaults each missing name on its own.
        const queryParams: Record<string, string> = {
          ...(firstName ? { first_name: firstName } : {}),
          ...(lastName ? { last_name: lastName } : {}),
        };
        const { body } = await socket.get<SubscribeResponse>(
          getWebhookUrl(queryParams),
        );
        const { quickReplies, arrangedMessages, participantsList } =
          preprocessMessages(
            body.messages,
            participants,
            body.profile,
            config.apiUrl,
          );

        setProfile(body.profile);
        setSuggestions(quickReplies);
        setMessages(arrangedMessages);
        setParticipants(participantsList);
        setConnectionState(ConnectionState.connected);
      } catch (error) {
        if (
          error instanceof SocketIoClientError &&
          socketErrorHandlers?.[error.statusCode]
        ) {
          socketErrorHandlers[error.statusCode](error);
        } else {
          setConnectionState(ConnectionState.error);
          // eslint-disable-next-line no-console
          console.error("Unable to subscribe user", error);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      getWebhookUrl,
      participants,
      setConnectionState,
      setMessages,
      setParticipants,
      socket,
    ],
  );
  const pendingSubscription = useRef<Promise<void>>(undefined);
  // The server sends `settings` again on every reconnect, which would start
  // a second silent subscription while the first waits for the socket.
  const handleSubscription = (firstName?: string, lastName?: string) => {
    pendingSubscription.current ??= requestSubscription(
      firstName,
      lastName,
    ).finally(() => {
      pendingSubscription.current = undefined;
    });

    return pendingSubscription.current;
  };
  const subscribe = async (first_name: string = "", last_name: string = "") => {
    const { body } = await socket.get<SubscribeResponse>(
      getWebhookUrl({ first_name, last_name }),
    );

    setProfile(body.profile);

    return body;
  };
  const sendGetStarted = async (foreign_id: string) => {
    await handleSend({
      data: {
        type: Web.InboundMessageType.postback,
        data: {
          text: t("messages.get_started"),
          payload: "GET_STARTED",
        },
        author: foreign_id,
      },
    });

    // Notify other tabs that we've subscribed and sent the 1st msg (so they reload)
    setTimeout(() => {
      postMessage({ event: "subscribed" });
    }, 500);
  };

  useSubscribe<Web.OutboundMessage>(StdEventType.message, handleNewIOMessage);

  useSubscribe<boolean>(StdEventType.typing, setShowTypingIndicator);

  // A ref, not the effect alone: StrictMode runs mount effects twice.
  const reportedConnectionState = useRef<ConnectionState>(undefined);

  useEffect(() => {
    if (reportedConnectionState.current === connectionState) return;
    reportedConnectionState.current = connectionState;
    config.onConnectionChange?.(connectionState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionState]);

  useEffect(() => {
    if (syncState && isOpen) {
      updateNewMessagesCount(0);
    }
  }, [syncState, isOpen]);

  useSubscribeBroadcastChannel("logout", () => {
    socket.disconnect();
  });

  useSubscribeBroadcastChannel("subscribed", () => {
    socket.forceReconnect();
  });

  useSubscribe("error", ({ message, statusCode }: SocketErrorResponse) => {
    const err = new SocketIoClientError(socket, message, statusCode);

    socketErrorHandlers?.[statusCode](err);
  });

  useSubscribe("settings", ({ profile, messages = [] }: ChannelSettings) => {
    setProfile(profile);

    if (!profile && subscribesSilently(config)) {
      handleSubscription(config.profile?.firstName, config.profile?.lastName);
    }

    const { quickReplies, arrangedMessages, participantsList } =
      preprocessMessages(messages, participants, profile, config.apiUrl);

    setSuggestions(quickReplies);
    setMessages(arrangedMessages);
    setParticipants(participantsList);
  });

  useEffect(() => {
    const startConnection = () => {
      setConnectionState(ConnectionState.notConnectedYet);
    };
    const endConnection = () => {
      setConnectionState(ConnectionState.disconnected);
    };

    socket.io.on("open", startConnection);
    socket.io.on("reconnect", startConnection);
    socket.io.on("close", endConnection);
    socket.io.on("reconnect_error", endConnection);
    socket.io.on("reconnect_failed", endConnection);

    return () => {
      socket.io.off("open", startConnection);
      socket.io.off("reconnect", startConnection);
      socket.io.off("close", endConnection);
      socket.io.off("reconnect_error", endConnection);
      socket.io.off("reconnect_failed", endConnection);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // @TODO : enhance the participants logic
    const newParticipants = [...participants];

    newParticipants[0].imageUrl = settings.avatarUrl;
    setParticipants(newParticipants);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.avatarUrl]);

  const contextValue: ChatContextType = {
    participants,
    setParticipants,
    outgoingMessageState,
    setOutgoingMessageState,
    connectionState,
    setConnectionState: updateConnectionState,
    messages: messages.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    ),
    setMessages,
    newMessagesCount,
    setNewMessagesCount: updateNewMessagesCount,
    newIOMessage,
    setNewIOMessage,
    send: handleSend,
    showTypingIndicator: settings.showTypingIndicator && showTypingIndicator,
    setShowTypingIndicator,
    suggestions,
    setSuggestions,
    file,
    setFile,
    message,
    setMessage,
    handleSubscription,
    profile,
    subscribe,
    sendGetStarted,
  };

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);

  if (!context) {
    throw new Error("useChat must be used within a ChatContext");
  }

  return context;
};

export default ChatProvider;
