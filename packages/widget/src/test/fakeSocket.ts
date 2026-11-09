/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { vi } from "vitest";

import type { SocketIoClient } from "../utils/SocketIoClient";

type Listener = (payload?: unknown) => void;

const createEmitter = () => {
  const listeners = new Map<string, Set<Listener>>();

  return {
    on: (event: string, listener: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off: (event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener);
    },
    emit: (event: string, payload?: unknown) => {
      listeners.get(event)?.forEach((listener) => listener(payload));
    },
  };
};

/**
 * Stands in for the widget's socket client so a test can play the server.
 * Mock `getSocketIoClient` in `utils/SocketIoClient` to return `socket`.
 */
export const createFakeSocket = () => {
  const events = createEmitter();
  const manager = createEmitter();
  const mock = {
    on: vi.fn(events.on),
    off: vi.fn(events.off),
    io: { on: manager.on, off: manager.off },
    connect: vi.fn(),
    disconnect: vi.fn(),
    forceReconnect: vi.fn(async () => {}),
    get: vi.fn(),
    post: vi.fn(async () => ({ statusCode: 200, body: {} })),
  };

  return {
    socket: mock as unknown as SocketIoClient,
    /** The socket's methods, as spies. */
    mock,
    /** Delivers a server event, such as `settings` or `message`. */
    emit: events.emit,
    /** Fires a connection event of the socket.io manager, such as `open`. */
    emitIo: manager.emit,
  };
};

export type FakeSocket = ReturnType<typeof createFakeSocket>;

/** The `settings` event a web source sends on connect. */
export const createChannelSettings = (
  overrides: Record<string, unknown> = {},
) => ({
  menu: [],
  secret: "",
  allowed_domains: "",
  start_button: true,
  input_disabled: false,
  persistent_menu: true,
  window_title: "Test widget",
  show_emoji: false,
  show_file: false,
  show_location: false,
  allowed_upload_types: "image/png",
  greeting_message: "Welcome!",
  messages: [],
  profile: undefined,
  thread_id: null,
  ...overrides,
});
