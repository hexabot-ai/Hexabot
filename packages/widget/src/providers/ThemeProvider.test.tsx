/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Config } from "../types/config.types";

import type { ChatSettings } from "./SettingsProvider";
import { ThemeProvider, useTheme } from "./ThemeProvider";

const mockUseConfig = vi.fn<() => Config>();
const mockUseSettings = vi.fn<() => ChatSettings>();

vi.mock("./ConfigProvider", () => ({
  useConfig: () => mockUseConfig(),
}));

vi.mock("./SettingsProvider", () => ({
  useSettings: () => mockUseSettings(),
}));

const createMockSettings = (): ChatSettings => ({
  showEmoji: true,
  showFile: true,
  showLocation: true,
  showMenu: true,
  showTypingIndicator: true,
  alwaysScrollToBottom: true,
  focusOnOpen: true,
  title: "Hexabot",
  titleImageUrl: "",
  inputDisabled: false,
  placeholder: "Write something...",
  menu: [],
  autoFlush: true,
  allowedUploadTypes: ["image/png"],
  theme: undefined,
  greetingMessage: "Welcome !",
  avatarUrl: "",
});
const createMatchMediaMock = (matches: boolean) => {
  return vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};
const ThemeProbe = () => {
  const theme = useTheme();

  return (
    <div
      data-theme-probe="1"
      data-mode={theme.resolvedMode}
      data-primary={theme.palette.primary}
    />
  );
};

describe("ThemeProvider", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: createMatchMediaMock(true),
    });
    mockUseConfig.mockReturnValue({
      apiUrl: "https://example.com/api",
      channel: "console",
      sourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      language: "en",
      maxUploadSize: 10,
      theme: { mode: "system" },
    });
    mockUseSettings.mockReturnValue(createMockSettings());
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

  it("renders the widget root with dark mode css variables when system is dark", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <ThemeProvider>
          <ThemeProbe />
        </ThemeProvider>,
      );
    });

    const rootNode = container.querySelector<HTMLElement>(".hb-theme-root");
    const probeNode = container.querySelector("[data-theme-probe='1']");

    expect(rootNode?.getAttribute("data-theme-mode")).toBe("dark");
    expect(rootNode?.style.getPropertyValue("--hb-color-surface-panel")).toBe(
      "#141A20",
    );
    expect(probeNode?.getAttribute("data-mode")).toBe("dark");
    expect(probeNode?.getAttribute("data-primary")).toBe("#111827");
  });

  it("uses the top-level config mode over nested theme mode", async () => {
    mockUseConfig.mockReturnValue({
      apiUrl: "https://example.com/api",
      channel: "console",
      sourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      language: "en",
      maxUploadSize: 10,
      mode: "light",
      theme: { mode: "dark" },
    });

    await act(async () => {
      root = createRoot(container);
      root.render(
        <ThemeProvider>
          <ThemeProbe />
        </ThemeProvider>,
      );
    });

    const rootNode = container.querySelector(".hb-theme-root");
    const probeNode = container.querySelector("[data-theme-probe='1']");

    expect(rootNode?.getAttribute("data-theme-mode")).toBe("light");
    expect(probeNode?.getAttribute("data-mode")).toBe("light");
    expect(probeNode?.getAttribute("data-primary")).toBe("#0074D9");
  });
});
