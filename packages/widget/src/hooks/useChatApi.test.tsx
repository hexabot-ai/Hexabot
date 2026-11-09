/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { act, type ReactElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The package entry, so these tests also pin the public surface.
import {
  type ChatApi,
  type Config,
  ConnectionState,
  UiChatWidget,
  useChat,
} from "../index";
import {
  createChannelSettings,
  createFakeSocket,
  type FakeSocket,
} from "../test/fakeSocket";

let fake: FakeSocket;

vi.mock("../utils/SocketIoClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/SocketIoClient")>()),
  getSocketIoClient: () => fake.socket,
}));

const config: Partial<Config> = {
  apiUrl: "http://localhost:4000/api",
  channel: "web",
  sourceId: "web-source",
};
const subscriber = {
  id: "subscriber-1",
  foreignId: "visitor-1",
  firstName: "Ada",
  lastName: "Lovelace",
  locale: null,
  gender: null,
  language: "en",
  channel: { name: "web" },
};
const botMessage = (mid: string) => ({
  mid,
  author: "chatbot",
  createdAt: "2026-11-09T10:00:00.000Z",
  type: "quick_replies",
  data: {
    text: "Pick one",
    quick_replies: [
      { content_type: "text", title: "Pricing", payload: "PRICING" },
    ],
  },
});
const webhookUrl = "/webhook/web-source/";

describe("useChat", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let api: ChatApi;
  const Probe = ({ onRender }: { onRender: (chat: ChatApi) => void }) => {
    onRender(useChat());

    return null;
  };
  const probe = (
    <Probe
      onRender={(chat) => {
        api = chat;
      }}
    />
  );
  const render = async (element: ReactElement) => {
    await act(async () => {
      root = createRoot(container);
      root.render(element);
    });
  };
  const find = <T extends Element = Element>(selector: string) =>
    container.querySelector<T>(selector);

  beforeEach(() => {
    fake = createFakeSocket();
    sessionStorage.clear();
    // jsdom has no layout, so the message list cannot scroll.
    Element.prototype.scrollTo = () => {};
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = undefined;
    }
    container.remove();
  });

  it("lets a CustomComposer replace the input area and send text", async () => {
    const Composer = () => {
      const { sendText } = useChat();

      return (
        <button data-testid="composer" onClick={() => sendText("Hello")} />
      );
    };

    await render(
      <UiChatWidget config={config} defaultIsOpen CustomComposer={Composer} />,
    );

    expect(find(".hb-user-input")).toBeNull();

    await act(async () => {
      find<HTMLButtonElement>("[data-testid='composer']")!.click();
    });

    expect(fake.mock.post).toHaveBeenCalledWith(webhookUrl, {
      data: expect.objectContaining({ type: "text", data: { text: "Hello" } }),
    });
  });

  it("sends postbacks and quick replies like the built-in buttons", async () => {
    await render(<UiChatWidget config={config}>{probe}</UiChatWidget>);

    await act(() => api.sendPostback("HELP", "Help"));
    await act(() =>
      api.sendQuickReply({ text: "Pricing", payload: "PRICING" }),
    );

    expect(fake.mock.post).toHaveBeenNthCalledWith(1, webhookUrl, {
      data: expect.objectContaining({
        type: "postback",
        data: { payload: "HELP", text: "Help" },
      }),
    });
    expect(fake.mock.post).toHaveBeenNthCalledWith(2, webhookUrl, {
      data: expect.objectContaining({
        type: "quick_reply",
        data: { text: "Pricing", payload: "PRICING" },
      }),
    });
  });

  it("rejects a file the source does not accept, without sending it", async () => {
    await render(<UiChatWidget config={config}>{probe}</UiChatWidget>);
    await act(async () =>
      fake.emit(
        "settings",
        createChannelSettings({ allowed_upload_types: "audio/webm" }),
      ),
    );

    const text = new File(["hi"], "notes.txt", { type: "text/plain" });
    const voice = new File(["..."], "voice.webm", { type: "audio/webm" });

    await expect(api.sendFile(text)).rejects.toThrow(
      "This file type is not supported.",
    );
    expect(fake.mock.post).not.toHaveBeenCalled();

    await act(() => api.sendFile(voice));

    expect(fake.mock.post).toHaveBeenCalledWith(webhookUrl, {
      data: expect.objectContaining({
        type: "file",
        data: {
          name: "voice.webm",
          size: voice.size,
          type: "audio/webm",
          file: voice,
        },
      }),
    });
  });

  it("exposes the conversation, quick replies, menu, and window state", async () => {
    const menu = [{ type: "postback", title: "Help", payload: "HELP" }];

    await render(
      <UiChatWidget config={config} defaultIsOpen>
        {probe}
      </UiChatWidget>,
    );
    await act(async () =>
      fake.emit("settings", createChannelSettings({ menu })),
    );
    await act(async () => fake.emit("message", botMessage("m-1")));

    expect(api.messages.map(({ mid }) => mid)).toEqual(["m-1"]);
    expect(api.suggestions).toEqual([{ text: "Pricing", payload: "PRICING" }]);
    expect(api.menu).toEqual(menu);
    expect(api.isOpen).toBe(true);

    await act(async () => api.close());

    expect(api.isOpen).toBe(false);
    expect(find(".hb-chat-window")).toBeNull();

    await act(async () => api.open());

    expect(find(".hb-chat-window")).not.toBeNull();
  });

  it("subscribes the visitor with the names it is given", async () => {
    fake.mock.get.mockResolvedValue({
      statusCode: 200,
      body: { profile: subscriber, messages: [] },
    });

    await render(<UiChatWidget config={config}>{probe}</UiChatWidget>);
    await act(() => api.subscribe({ firstName: "Ada", lastName: "Lovelace" }));

    expect(fake.mock.get).toHaveBeenCalledWith(
      `${webhookUrl}?first_name=Ada&last_name=Lovelace`,
    );
    expect(api.profile?.id).toBe("subscriber-1");
    expect(api.connectionState).toBe(ConnectionState.connected);
    expect(fake.mock.post).not.toHaveBeenCalled();
  });
});

describe("config callbacks", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    fake = createFakeSocket();
    sessionStorage.clear();
    Element.prototype.scrollTo = () => {};
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
  });

  it("reports each new message once and every connection change", async () => {
    const onMessage = vi.fn();
    const onConnectionChange = vi.fn();

    await act(async () => {
      root = createRoot(container);
      root.render(
        <UiChatWidget config={{ ...config, onMessage, onConnectionChange }} />,
      );
    });
    await act(async () => fake.emitIo("open"));
    await act(async () => fake.emit("message", botMessage("m-1")));
    await act(async () => fake.emit("message", botMessage("m-1")));
    await act(async () => fake.emitIo("close"));

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ mid: "m-1", direction: "received" }),
    );
    expect(onConnectionChange.mock.calls).toEqual([
      [ConnectionState.connected],
      [ConnectionState.notConnectedYet],
      [ConnectionState.disconnected],
    ]);
  });
});
