/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Web } from "../types/message.types";
import { OutgoingMessageState } from "../types/state.types";

import UserInput from "./UserInput";

const mockUseChat = vi.fn();

vi.mock("../providers/ChatProvider", () => ({
  useChat: () => mockUseChat(),
}));

vi.mock("../providers/ConfigProvider", () => ({
  useConfig: () => ({ maxUploadSize: 20 * 1024 * 1024 }),
}));

vi.mock("../providers/SettingsProvider", () => ({
  useSettings: () => ({
    menu: [],
    focusOnOpen: false,
    autoFlush: true,
    allowedUploadTypes: ["image/png"],
    showEmoji: false,
    showLocation: false,
    showFile: false,
    placeholder: "Write something...",
  }),
}));

vi.mock("../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const createChat = (overrides: Record<string, unknown> = {}) => ({
  suggestions: [],
  message: "",
  setMessage: vi.fn(),
  file: null,
  setFile: vi.fn(),
  send: vi.fn(),
  outgoingMessageState: OutgoingMessageState.sent,
  ...overrides,
});

describe("UserInput", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  const getSendButton = () =>
    container.querySelector<HTMLButtonElement>(
      ".hb-user-input--button-icon-wrapper",
    )!;
  const renderInput = async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<UserInput />);
    });
  };

  beforeEach(() => {
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
    vi.clearAllMocks();
  });

  it("disables the send button when there is neither text nor a file", async () => {
    mockUseChat.mockReturnValue(createChat());

    await renderInput();

    expect(getSendButton().disabled).toBe(true);
  });

  it("sends an attached file from the send button when there is no text", async () => {
    const file = new File(["png"], "photo.png", { type: "image/png" });
    const chat = createChat({ file });

    mockUseChat.mockReturnValue(chat);

    await renderInput();

    expect(getSendButton().disabled).toBe(false);

    await act(async () => {
      getSendButton().click();
    });

    expect(chat.send).toHaveBeenCalledTimes(1);
    expect(chat.send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          type: Web.InboundMessageType.file,
          data: {
            name: "photo.png",
            size: file.size,
            type: "image/png",
            file,
          },
        },
      }),
    );
  });

  it("does not submit the composer form when the send button is clicked", async () => {
    const chat = createChat({ message: "Hello" });
    const onSubmit = vi.fn((event: Event) => event.preventDefault());

    mockUseChat.mockReturnValue(chat);

    await renderInput();
    container.querySelector("form")!.addEventListener("submit", onSubmit);

    await act(async () => {
      getSendButton().click();
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(getSendButton().type).toBe("button");
    expect(chat.send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          type: Web.InboundMessageType.text,
          data: { text: "Hello" },
        },
      }),
    );
  });
});
