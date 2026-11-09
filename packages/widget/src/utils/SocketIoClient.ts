/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { io, ManagerOptions, Socket, SocketOptions } from "socket.io-client";

import { Config, ConfigTransport } from "../types/config.types";
import {
  IOIncomingMessage,
  IOOutgoingMessage,
} from "../types/io-message.types";

import { SocketIoClientError } from "./SocketIoClientError";

type SocketIoClientConfig = Partial<ManagerOptions & SocketOptions>;

type SocketIoEventHandlers = {
  onConnect?: () => void;
  onDisconnect?: (reason: string, details: unknown) => void;
  onConnectError?: (error: Error) => void;
};

const TRANSPORTS_BY_MODE: Record<
  ConfigTransport,
  NonNullable<ManagerOptions["transports"]>
> = {
  ws: ["websocket"],
  polling: ["polling"],
};

export const resolveSocketIoTransports = (
  transport: ConfigTransport = "ws",
): NonNullable<ManagerOptions["transports"]> => {
  return TRANSPORTS_BY_MODE[transport];
};

export class SocketIoClient {
  /**
   * Default configuration for the socket client
   * @static
   */
  static defaultConfig: SocketIoClientConfig = {
    // Socket options
    // auth: undefined,

    // Manager options
    autoConnect: true,
    // parser: undefined,
    randomizationFactor: 0.5,
    reconnection: true,
    reconnectionAttempts: 100,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    retries: 0,
    ackTimeout: 15_000,

    // Low Level Options
    addTrailingSlash: true, // eg: https://domain.path/ => https://domain.path/
    // autoUnref:false, //  firefox only option
    // path: "/socket.io", // This is the socket path in the server, leave it as default unless changed manually in server
    transports: resolveSocketIoTransports("ws"),
    upgrade: true,
    withCredentials: true,
  };

  private socket: Socket;

  private config: SocketIoClientConfig;

  constructor(
    apiUrl: string,
    socketConfig: SocketIoClientConfig,
    handlers: SocketIoEventHandlers,
  ) {
    this.config = {
      ...SocketIoClient.defaultConfig,
      ...socketConfig,
      autoConnect: false,
    };
    const url = new URL(apiUrl);

    this.socket = io(url.origin, this.config);
    this.init(handlers);
  }

  get io() {
    return this.socket.io;
  }

  /**
   * Initializes the socket client and sets up event handlers.
   * @param handlers Event handlers for connection, disconnection, and connection errors
   */
  public init({
    onConnect,
    onDisconnect,
    onConnectError,
  }: SocketIoEventHandlers) {
    onConnect && this.uniqueOn("connect", onConnect);
    onDisconnect && this.uniqueOn("disconnect", onDisconnect);
    onConnectError && this.uniqueOn("connect_error", onConnectError);
  }

  /**
   * Registers an event handler for the specified event and removes any existing handlers.
   * @param event The event name
   * @param callback The callback function to handle the event
   */
  //TODO: Fix any type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private uniqueOn(event: string, callback: (...args: any) => void) {
    this.socket.off(event);
    this.socket.on(event, callback);
  }

  /**
   * Disconnects the socket client.
   */
  public disconnect() {
    this.socket.disconnect();
  }

  /**
   * Connects the socket client.
   */
  public connect() {
    if (!this.socket.active) this.socket.connect();
  }

  /**
   * Waits for disconnection of the socket client.
   */
  public waitForDisconnect() {
    return new Promise<void>((resolve) => {
      this.socket.once("disconnect", () => resolve());

      this.socket.disconnect();
    });
  }

  /**
   * Reconnects the socket client using mutex across tabs.
   */
  public async forceReconnect(timeoutMs = 10_000) {
    const run = async () => {
      const socket = this.socket;

      if (!socket) {
        throw new Error("socket not initialized");
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let timer: any;
      const off: Array<() => void> = [];

      try {
        await new Promise<void>((resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("reconnect timeout")),
            timeoutMs,
          );

          const onConnect = () => {
            resolve();
          };
          const onErr = (e: unknown) => {
            reject(e);
          };

          socket.once("connect", onConnect);
          socket.once("connect_error", onErr);

          off.push(
            () => socket.off("connect", onConnect),
            () => socket.off("connect_error", onErr),
          );

          // Force a fresh handshake if we were connected or mid-attempt
          if (socket.connected) {
            this.waitForDisconnect()
              .then(() => {
                socket.connect();
              })
              .catch(reject);
          } else {
            socket.connect();
          }
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(err);
      } finally {
        clearTimeout(timer);
        off.forEach((fn) => fn());
      }
    };
    const locks = navigator.locks;

    if (locks?.request) {
      // Keep it exclusive but guaranteed to release via timeout/error handling
      await locks.request("ws_connection", { mode: "exclusive" }, run);
    } else {
      // Fallback when Web Locks isn’t supported
      await run();
    }
  }

  /**
   * Registers an event handler for the specified event.
   * @param event The event name
   * @param callback The callback function to handle the event
   */
  public on<T>(event: string, callback: (data: T) => void) {
    this.socket.on(event, callback);
  }

  /**
   * Removes an event handler for the specified event.
   * @param event The event name
   * @param callback The callback function to remove
   */
  //TODO: Fix any type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public off(event: string, callback: (...args: any) => void) {
    this.socket.off(event, callback);
  }

  /**
   * Sends a request to the server and waits for an acknowledgment.
   * @param options The request options including URL and method
   * @returns The response from the server
   * @throws Error if the request fails
   */
  public async request<T>(
    options: Pick<IOOutgoingMessage, "url" | "method"> &
      Partial<IOOutgoingMessage>,
  ): Promise<IOIncomingMessage<T>> {
    const response: IOIncomingMessage<T> = await this.socket.emitWithAck(
      options.method,
      options,
    );

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return response;
    }

    throw new SocketIoClientError(
      this,
      JSON.stringify(response.body),
      response.statusCode,
    );
  }

  /**
   * How many times a GET is sent before a disconnect failure is final.
   * @static
   */
  static getAttempts = 3;

  /**
   * Sends a GET request to the server.
   *
   * socket.io rejects a request still in flight when the socket disconnects,
   * as a network drop or a React StrictMode remount does mid-subscribe. A
   * GET is safe to send again, and socket.io holds what is emitted while
   * disconnected until the next connection, so the request is retried.
   * @param url The URL to send the request to
   * @param options Optional request options
   * @returns The response from the server
   */
  public async get<T>(
    url: string,
    options?: Partial<Omit<IOOutgoingMessage, "url" | "method" | "body">>,
  ): Promise<IOIncomingMessage<T>> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.request<T>({
          method: "get",
          url,
          ...options,
        });
      } catch (error) {
        // A server answer is final, and so is a timeout on a live socket.
        const cutOff =
          !(error instanceof SocketIoClientError) && !this.socket.connected;

        if (!cutOff || attempt >= SocketIoClient.getAttempts) {
          throw error;
        }
      }
    }
  }

  public async post<T>(
    url: string,
    options: Partial<Omit<IOOutgoingMessage, "url" | "method">>,
  ): Promise<IOIncomingMessage<T>> {
    return await this.request({
      method: "post",
      url,
      ...options,
    });
  }
}

let socketIoClient: SocketIoClient;

/**
 * Returns a singleton instance of the socket io client
 *
 * @param config The socket connection config
 * @param handlers Event handlers
 * @returns Socket io client instance
 */
export const getSocketIoClient = (
  config: Config,
  handlers: SocketIoEventHandlers,
) => {
  const sourceId = config.sourceId.trim();

  if (!sourceId) {
    throw new Error("Widget config sourceId is required");
  }

  if (!socketIoClient) {
    socketIoClient = new SocketIoClient(
      config.apiUrl,
      {
        query: {
          source_id: sourceId,
        },
        transports: resolveSocketIoTransports(config.transport ?? "ws"),
      },
      handlers,
    );
  }

  return socketIoClient;
};
