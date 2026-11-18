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
    await act(async () =>
      fake.emit("settings", createChannelSettings({ profile: subscriber })),
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

  it("keeps the menu readable when persistent_menu hides its button", async () => {
    const menu = [{ type: "postback", title: "Help", payload: "HELP" }];

    await render(
      <UiChatWidget config={config} defaultIsOpen>
        {probe}
      </UiChatWidget>,
    );
    await act(async () =>
      fake.emit(
        "settings",
        createChannelSettings({ menu, persistent_menu: false }),
      ),
    );

    expect(find(".hb-user-input--menu")).toBeNull();
    expect(api.menu).toEqual(menu);
  });

  it("plays attachments from the widget's origin, not API_ORIGIN", async () => {
    const path = "/api/webhook/web-source/download/voice.webm?t=abc";

    await render(
      <UiChatWidget config={config} defaultIsOpen>
        {probe}
      </UiChatWidget>,
    );
    await act(async () =>
      fake.emit("message", {
        mid: "m-voice",
        author: "chatbot",
        createdAt: "2026-11-09T10:00:00.000Z",
        type: "file",
        data: { type: "audio", url: `https://api.example.com${path}` },
      }),
    );

    const rebased = `http://localhost:4000${path}`;

    expect(find("audio source")?.getAttribute("src")).toBe(rebased);
    expect(api.messages[0].data).toMatchObject({ url: rebased });
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
    await act(async () =>
      fake.emit("settings", createChannelSettings({ profile: subscriber })),
    );
    await act(async () => fake.emit("message", botMessage("m-1")));
    await act(async () => fake.emit("message", botMessage("m-1")));
    await act(async () => fake.emitIo("close"));

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ mid: "m-1", direction: "received" }),
    );
    expect(onConnectionChange.mock.calls).toEqual([
      [ConnectionState.notConnectedYet],
      [ConnectionState.connected],
      [ConnectionState.disconnected],
    ]);
  });
});

describe("connection state", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let api: ChatApi;
  const onConnectionChange = vi.fn<(state: ConnectionState) => void>();
  const Probe = ({ onRender }: { onRender: (chat: ChatApi) => void }) => {
    onRender(useChat());

    return null;
  };
  const render = async (props: Partial<Config> = {}) => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <UiChatWidget
          config={{ ...config, ...props, onConnectionChange }}
          defaultIsOpen
        >
          <Probe
            onRender={(chat) => {
              api = chat;
            }}
          />
        </UiChatWidget>,
      );
    });
  };
  const find = <T extends Element = Element>(selector: string) =>
    container.querySelector<T>(selector);
  const reported = () => onConnectionChange.mock.calls.map(([state]) => state);
  const restoreSession = () =>
    act(async () =>
      fake.emit(
        "settings",
        createChannelSettings({
          profile: subscriber,
          messages: [botMessage("m-1")],
        }),
      ),
    );
  // A send the server does not acknowledge, which only shows in the state.
  const failSend = async () => {
    fake.mock.post.mockRejectedValueOnce(new Error("operation has timed out"));
    await act(() => api.sendText("Hello"));
  };
  // As socket.io-client does to a connected socket that is dropped and
  // reopened. Armed after mounting, which reconnects the socket too.
  const armReconnect = () =>
    fake.mock.forceReconnect.mockClear().mockImplementation(async () => {
      fake.emitIo("close");
      fake.emitIo("open");

      return true;
    });
  const typeInto = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const submitNameForm = async () => {
    const [first, last] = container.querySelectorAll<HTMLInputElement>(
      ".user-subscription-form-input",
    );

    await act(async () => {
      typeInto(first, "Ada");
      typeInto(last, "Lovelace");
    });
    await act(async () => {
      find<HTMLButtonElement>(".user-subscription-form-button-submit")!.click();
    });
  };

  beforeEach(() => {
    fake = createFakeSocket();
    onConnectionChange.mockReset();
    sessionStorage.clear();
    Element.prototype.scrollTo = () => {};
    vi.spyOn(console, "error").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
    vi.restoreAllMocks();
  });

  it("is connected once the server restores the session after a reload", async () => {
    await render();
    await act(async () => fake.emitIo("open"));

    expect(api.connectionState).toBe(ConnectionState.notConnectedYet);

    await restoreSession();

    expect(api.connectionState).toBe(ConnectionState.connected);
    expect(fake.mock.get).not.toHaveBeenCalled();
    expect(reported()).toEqual([
      ConnectionState.notConnectedYet,
      ConnectionState.connected,
    ]);
  });

  it("is connected again once the server restores the session after a drop", async () => {
    await render();
    await act(async () => fake.emitIo("open"));
    await restoreSession();
    await act(async () => fake.emitIo("close"));
    await act(async () => fake.emitIo("reconnect_error"));
    await act(async () => {
      fake.emitIo("open");
      fake.emitIo("reconnect");
    });

    expect(api.connectionState).toBe(ConnectionState.notConnectedYet);

    await restoreSession();

    expect(api.connectionState).toBe(ConnectionState.connected);
    expect(reported()).toEqual([
      ConnectionState.notConnectedYet,
      ConnectionState.connected,
      ConnectionState.disconnected,
      ConnectionState.notConnectedYet,
      ConnectionState.connected,
    ]);
  });

  it("is not connected while the pre-chat form waits for the visitor", async () => {
    await render();
    await act(async () => fake.emitIo("open"));
    await act(async () => fake.emit("settings", createChannelSettings()));

    expect(find(".user-subscription")).not.toBeNull();
    expect(api.connectionState).toBe(ConnectionState.notConnectedYet);
    expect(reported()).toEqual([ConnectionState.notConnectedYet]);
  });

  it("is connected once a silent subscription succeeds", async () => {
    let answer: (response: unknown) => void = () => {};

    fake.mock.get.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    await render({ profile: { firstName: "Ada", lastName: "Lovelace" } });
    await act(async () => fake.emitIo("open"));
    await act(async () => fake.emit("settings", createChannelSettings()));

    expect(api.connectionState).toBe(ConnectionState.tryingToConnect);

    await act(async () =>
      answer({ statusCode: 200, body: { profile: subscriber, messages: [] } }),
    );

    expect(api.connectionState).toBe(ConnectionState.connected);
    expect(reported()).toEqual([
      ConnectionState.notConnectedYet,
      ConnectionState.tryingToConnect,
      ConnectionState.connected,
    ]);
  });

  it("is connected once the name form subscribes the visitor", async () => {
    fake.mock.get.mockResolvedValue({
      statusCode: 200,
      body: { profile: subscriber, messages: [] },
    });

    await render();
    await act(async () => fake.emitIo("open"));
    await act(async () => fake.emit("settings", createChannelSettings()));
    await submitNameForm();

    expect(fake.mock.get).toHaveBeenCalledWith(
      `${webhookUrl}?first_name=Ada&last_name=Lovelace`,
    );
    expect(fake.mock.post).toHaveBeenCalledWith(webhookUrl, {
      data: expect.objectContaining({
        type: "postback",
        data: expect.objectContaining({ payload: "GET_STARTED" }),
        author: "visitor-1",
      }),
    });
    expect(find(".hb-user-input")).not.toBeNull();
    expect(api.connectionState).toBe(ConnectionState.connected);
    expect(reported()).toEqual([
      ConnectionState.notConnectedYet,
      ConnectionState.tryingToConnect,
      ConnectionState.connected,
    ]);
  });

  it("keeps the error when the name form's GET_STARTED postback fails", async () => {
    fake.mock.get.mockResolvedValue({
      statusCode: 200,
      body: { profile: subscriber, messages: [] },
    });
    fake.mock.post.mockRejectedValueOnce(new Error("operation has timed out"));

    await render();
    await act(async () => fake.emitIo("open"));
    await act(async () => fake.emit("settings", createChannelSettings()));
    await submitNameForm();

    expect(api.connectionState).toBe(ConnectionState.error);
    expect(find(".hb-chat--error-button")).not.toBeNull();
  });

  it("reconnects and restores the session without flashing a disconnect", async () => {
    await render();
    await act(async () => fake.emitIo("open"));
    await restoreSession();
    await failSend();
    armReconnect();

    expect(api.connectionState).toBe(ConnectionState.error);

    onConnectionChange.mockClear();
    await act(() => api.reconnect());

    expect(fake.mock.forceReconnect).toHaveBeenCalledTimes(1);
    expect(api.connectionState).toBe(ConnectionState.tryingToConnect);

    await restoreSession();

    expect(api.connectionState).toBe(ConnectionState.connected);
    expect(reported()).toEqual([
      ConnectionState.tryingToConnect,
      ConnectionState.connected,
    ]);
  });

  it("reconnects to the pre-chat form when the server has no subscriber", async () => {
    await render();
    await act(async () => fake.emitIo("open"));
    await act(async () => fake.emit("settings", createChannelSettings()));
    armReconnect();
    await act(() => api.reconnect());
    await act(async () => fake.emit("settings", createChannelSettings()));

    expect(api.connectionState).toBe(ConnectionState.notConnectedYet);
    expect(find(".user-subscription")).not.toBeNull();
  });

  it("is disconnected when the socket does not come back", async () => {
    await render();
    await act(async () => fake.emitIo("open"));
    await restoreSession();
    fake.mock.forceReconnect.mockResolvedValue(false);
    await act(() => api.reconnect());

    expect(api.connectionState).toBe(ConnectionState.disconnected);
  });

  it("runs one reconnect at a time", async () => {
    let reconnected: (value: boolean) => void = () => {};

    await render();
    fake.mock.forceReconnect.mockClear().mockReturnValue(
      new Promise((resolve) => {
        reconnected = resolve;
      }),
    );

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;

    await act(async () => {
      first = api.reconnect();
      second = api.reconnect();
    });

    expect(second).toBe(first);

    await act(async () => {
      reconnected(true);
      await first;
    });

    expect(fake.mock.forceReconnect).toHaveBeenCalledTimes(1);
  });

  it("lets the error screen's retry button reconnect", async () => {
    await render();
    await act(async () => fake.emitIo("open"));
    await restoreSession();
    await failSend();
    armReconnect();
    await act(async () => {
      find<HTMLButtonElement>(".hb-chat--error-button")!.click();
    });

    expect(fake.mock.forceReconnect).toHaveBeenCalledTimes(1);
    expect(api.connectionState).toBe(ConnectionState.tryingToConnect);
    expect(find(".hb-chat--attempt-reconnect")).not.toBeNull();

    await restoreSession();

    expect(api.connectionState).toBe(ConnectionState.connected);
    expect(find(".hb-user-input")).not.toBeNull();
  });
});
