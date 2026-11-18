/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

export enum OutgoingMessageState {
  sent = 0,
  sending = 1,
  uploading = 2,
}

/** Whether the chat can be used, as `useChat()` and `onConnectionChange` report it. */
export enum ConnectionState {
  /** The socket dropped. socket.io reconnects it on its own. */
  disconnected = -1,
  /**
   * The chat cannot be used yet: the server has not answered the socket, or
   * the visitor has not subscribed (the pre-chat screen).
   */
  notConnectedYet = 0,
  /** Not set by the widget. */
  wantToConnect = 1,
  /** A subscription or a `reconnect()` is under way. */
  tryingToConnect = 2,
  /** The visitor is subscribed and the server serves them on this socket. */
  connected = 3,
  /** A subscription or a send failed. `reconnect()` recovers. */
  error = 4,
}

export enum ChatScreen {
  // Screen that shows up before the chat (user subscription)
  PRE_CHAT = "preChat",
  // Screen that shows up after the chat is closed (not in use yet)
  POST_CHAT = "postChat",
  // Screen that shows the messages and text input
  CHAT = "chat",
  // Screen that shows when trying to connect
  LOADING = "loading",
  // Screen that shows when connection is closed
  DISCONNECT = "disconnect",
  // Screen that indicates when an error occurs
  ERROR = "error",
}
