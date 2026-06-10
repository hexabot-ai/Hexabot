/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Direction, UiMessage, Web } from "../types/message.types";

import Message from "./Message";

const mockUseChat = vi.fn();

vi.mock("../providers/ChatProvider", () => ({
  useChat: () => mockUseChat(),
}));

const createMessage = (overrides: Partial<UiMessage> = {}): UiMessage => ({
  type: Web.OutboundMessageType.text,
  data: {
    text: "Hello",
  },
  mid: "message-1",
  author: "chatbot",
  read: true,
  delivery: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  direction: Direction.received,
  handover: false,
  ...overrides,
});

describe("Message", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockUseChat.mockReturnValue({
      participants: [
        {
          id: "chatbot",
          name: "Hexabot",
        },
      ],
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = undefined;
    }
    container.remove();
    vi.clearAllMocks();
  });

  it("does not render the default avatar when the participant has no image URL", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<Message message={createMessage()} />);
    });

    expect(container.querySelector(".hb-message--avatar")).toBeNull();
    expect(
      container
        .querySelector(".hb-message--content")
        ?.classList.contains("no-avatar"),
    ).toBe(true);
  });

  it("renders an avatar with background image when the participant has an image URL", async () => {
    mockUseChat.mockReturnValue({
      participants: [
        {
          id: "chatbot",
          name: "Hexabot",
          imageUrl: "https://example.com/avatar.png",
        },
      ],
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<Message message={createMessage()} />);
    });

    const avatarNode = container.querySelector<HTMLElement>(
      ".hb-message--avatar",
    );

    expect(avatarNode).not.toBeNull();
    expect(
      container
        .querySelector(".hb-message--content")
        ?.classList.contains("with-avatar"),
    ).toBe(true);
    expect(avatarNode?.style.backgroundImage).toContain(
      "https://example.com/avatar.png",
    );
  });

  it("renders an explicit custom avatar even when no image URL is configured", async () => {
    const CustomAvatar = () => <span data-custom-avatar="1" />;

    await act(async () => {
      root = createRoot(container);
      root.render(<Message message={createMessage()} Avatar={CustomAvatar} />);
    });

    expect(container.querySelector(".hb-message--avatar")).not.toBeNull();
    expect(container.querySelector("[data-custom-avatar='1']")).not.toBeNull();
  });

  it("marks the message for entry animation when requested", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<Message message={createMessage()} animate />);
    });

    expect(
      container
        .querySelector(".hb-message")
        ?.classList.contains("hb-message--new"),
    ).toBe(true);
    expect(
      container
        .querySelector(".hb-message--text-content")
        ?.classList.contains("typewriter"),
    ).toBe(true);
  });

  it("does not typewrite sent messages when animating", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Message
          message={createMessage({ direction: Direction.sent })}
          animate
        />,
      );
    });

    expect(
      container
        .querySelector(".hb-message--text-content")
        ?.classList.contains("typewriter"),
    ).toBe(false);
  });
});
