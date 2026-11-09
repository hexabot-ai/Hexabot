/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveSocketIoTransports, SocketIoClient } from "./SocketIoClient";
import { SocketIoClientError } from "./SocketIoClientError";

// The socket.io-client socket behind SocketIoClient.
const ioSocket = vi.hoisted(() => ({
  connected: true,
  emitWithAck: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("socket.io-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("socket.io-client")>()),
  io: () => ioSocket,
}));

describe("resolveSocketIoTransports", () => {
  it("maps ws transport mode to websocket only", () => {
    expect(resolveSocketIoTransports("ws")).toEqual(["websocket"]);
  });

  it("maps polling transport mode to polling only", () => {
    expect(resolveSocketIoTransports("polling")).toEqual(["polling"]);
  });
});

describe("SocketIoClient requests", () => {
  const url = "/webhook/web-source/";
  let client: SocketIoClient;
  // What socket.io-client does to a request in flight on disconnect.
  const cutOffByDisconnect = async () => {
    ioSocket.connected = false;
    throw new Error("socket has been disconnected");
  };

  beforeEach(() => {
    ioSocket.connected = true;
    ioSocket.emitWithAck.mockReset();
    client = new SocketIoClient("http://localhost:4000/api", {}, {});
  });

  it("sends a GET again when a disconnect cuts it off", async () => {
    ioSocket.emitWithAck
      .mockImplementationOnce(cutOffByDisconnect)
      .mockImplementationOnce(async () => {
        ioSocket.connected = true;

        return { statusCode: 200, body: { profile: "visitor" } };
      });

    await expect(client.get(url)).resolves.toMatchObject({
      body: { profile: "visitor" },
    });
    expect(ioSocket.emitWithAck).toHaveBeenCalledTimes(2);
    expect(ioSocket.emitWithAck).toHaveBeenLastCalledWith("get", {
      method: "get",
      url,
    });
  });

  it("gives up on a GET after its last attempt", async () => {
    ioSocket.emitWithAck.mockImplementation(cutOffByDisconnect);

    await expect(client.get(url)).rejects.toThrow(
      "socket has been disconnected",
    );
    expect(ioSocket.emitWithAck).toHaveBeenCalledTimes(
      SocketIoClient.getAttempts,
    );
  });

  it("does not repeat a GET the server answered with an error", async () => {
    ioSocket.emitWithAck.mockResolvedValue({ statusCode: 403, body: "No" });

    await expect(client.get(url)).rejects.toBeInstanceOf(SocketIoClientError);
    expect(ioSocket.emitWithAck).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a GET that timed out on a live socket", async () => {
    ioSocket.emitWithAck.mockRejectedValue(
      new Error("operation has timed out"),
    );

    await expect(client.get(url)).rejects.toThrow("operation has timed out");
    expect(ioSocket.emitWithAck).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a POST, which could duplicate the message", async () => {
    ioSocket.emitWithAck.mockImplementation(cutOffByDisconnect);

    await expect(client.post(url, { data: {} })).rejects.toThrow(
      "socket has been disconnected",
    );
    expect(ioSocket.emitWithAck).toHaveBeenCalledTimes(1);
  });
});
