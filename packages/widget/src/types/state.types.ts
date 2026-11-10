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

export enum ConnectionState {
  disconnected = -1,
  notConnectedYet = 0,
  wantToConnect = 1,
  tryingToConnect = 2,
  connected = 3,
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
