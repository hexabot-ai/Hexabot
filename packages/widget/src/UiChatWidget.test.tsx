/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { act, type ReactElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChat } from "./providers/ChatProvider";
import {
  createChannelSettings,
  createFakeSocket,
  type FakeSocket,
} from "./test/fakeSocket";
import { ConnectionState } from "./types/state.types";
import UiChatWidget from "./UiChatWidget";

let fake: FakeSocket;

vi.mock("./utils/SocketIoClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./utils/SocketIoClient")>()),
  getSocketIoClient: () => fake.socket,
}));

const config = {
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

describe("UiChatWidget", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  const render = async (element: ReactElement) => {
    await act(async () => {
      root = createRoot(container);
      root.render(element);
    });
  };
  const find = (selector: string) => container.querySelector(selector);

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

  it("shows the name form before a visitor subscribes", async () => {
    await render(<UiChatWidget config={config} defaultIsOpen />);
    await act(async () => fake.emitIo("open"));

    expect(find(".user-subscription")).not.toBeNull();
  });

  it("shows the PreChat screen it is given", async () => {
    const PreChat = () => <div data-testid="custom-pre-chat" />;

    await render(
      <UiChatWidget config={config} defaultIsOpen PreChat={PreChat} />,
    );
    await act(async () => fake.emitIo("open"));

    expect(find("[data-testid='custom-pre-chat']")).not.toBeNull();
    expect(find(".user-subscription")).toBeNull();
  });

  it("renders its children inside the widget providers", async () => {
    const Probe = () => {
      const { connectionState } = useChat();

      return <div data-testid="probe" data-state={connectionState} />;
    };

    await render(
      <UiChatWidget config={config}>
        <Probe />
      </UiChatWidget>,
    );

    expect(find("[data-testid='probe']")?.getAttribute("data-state")).toBe(
      String(ConnectionState.connected),
    );
  });

  it("subscribes a configured profile without the form or a GET_STARTED postback", async () => {
    const PreChat = vi.fn(() => <div data-testid="custom-pre-chat" />);

    fake.mock.get.mockResolvedValue({
      statusCode: 200,
      body: { profile: subscriber, messages: [] },
    });

    await render(
      <UiChatWidget
        config={{
          ...config,
          profile: { firstName: "Ada", lastName: "Lovelace" },
        }}
        defaultIsOpen
        PreChat={PreChat}
      />,
    );
    await act(async () => fake.emitIo("open"));

    // Waits on the server settings behind a loader, not the form.
    expect(find(".hb-chat--attempt-reconnect")).not.toBeNull();

    await act(async () => fake.emit("settings", createChannelSettings()));

    expect(fake.mock.get).toHaveBeenCalledWith(
      "/webhook/web-source/?first_name=Ada&last_name=Lovelace",
    );
    expect(find(".hb-user-input")).not.toBeNull();
    expect(PreChat).not.toHaveBeenCalled();
    expect(fake.mock.post).not.toHaveBeenCalled();
  });

  describe("menu button", () => {
    const menu = [{ type: "postback", title: "Help", payload: "HELP" }];

    it("shows for a source with a persistent menu", async () => {
      await render(<UiChatWidget config={config} defaultIsOpen />);
      await act(async () =>
        fake.emit("settings", createChannelSettings({ menu })),
      );

      expect(find(".hb-user-input--menu")).not.toBeNull();
    });

    it("hides when the source turns persistent_menu off", async () => {
      await render(<UiChatWidget config={config} defaultIsOpen />);
      await act(async () =>
        fake.emit(
          "settings",
          createChannelSettings({ menu, persistent_menu: false }),
        ),
      );

      expect(find(".hb-user-input")).not.toBeNull();
      expect(find(".hb-user-input--menu")).toBeNull();
    });

    it("shows from settings an older widget saved in the session", async () => {
      const scope = encodeURIComponent(`${config.apiUrl}::${config.sourceId}`);

      // As 3.6.0 cached them, without `showMenu`.
      sessionStorage.setItem(
        `hexabot:widget:settings:${scope}`,
        JSON.stringify({ menu, showEmoji: false, allowedUploadTypes: [] }),
      );

      await render(<UiChatWidget config={config} defaultIsOpen />);

      expect(find(".hb-user-input--menu")).not.toBeNull();
    });
  });

  it("runs one silent subscription when a reconnect resends the settings", async () => {
    let answer: (response: unknown) => void = () => {};

    fake.mock.get.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    await render(
      <UiChatWidget
        config={{
          ...config,
          profile: { firstName: "Ada", lastName: "Lovelace" },
        }}
        defaultIsOpen
      />,
    );
    await act(async () => fake.emit("settings", createChannelSettings()));
    await act(async () => fake.emit("settings", createChannelSettings()));

    expect(fake.mock.get).toHaveBeenCalledTimes(1);

    await act(async () =>
      answer({ statusCode: 200, body: { profile: subscriber, messages: [] } }),
    );

    expect(find(".hb-user-input")).not.toBeNull();
  });

  it("leaves a blank profile name to the API default", async () => {
    fake.mock.get.mockResolvedValue({
      statusCode: 200,
      body: { profile: subscriber, messages: [] },
    });

    await render(
      <UiChatWidget
        config={{ ...config, profile: { firstName: "Ada", lastName: "" } }}
      />,
    );
    await act(async () => fake.emit("settings", createChannelSettings()));

    expect(fake.mock.get).toHaveBeenCalledWith(
      "/webhook/web-source/?first_name=Ada",
    );
  });

  it("keeps the session subscriber over a configured profile", async () => {
    await render(
      <UiChatWidget
        config={{
          ...config,
          profile: { firstName: "Grace", lastName: "Hopper" },
        }}
        defaultIsOpen
      />,
    );
    await act(async () => fake.emitIo("open"));
    await act(async () =>
      fake.emit("settings", createChannelSettings({ profile: subscriber })),
    );

    expect(fake.mock.get).not.toHaveBeenCalled();
    expect(find(".hb-user-input")).not.toBeNull();
  });
});
