/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderHook } from "../../test/render-hook";

import {
  useResolvedColorMode,
  type WorkflowGraphColorMode,
} from "./useResolvedColorMode";

const mockSystemPreference = (prefersDark: boolean) => {
  const listeners = new Set<() => void>();
  const media = {
    matches: prefersDark,
    addEventListener: vi.fn((_type: string, listener: () => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: () => void) => {
      listeners.delete(listener);
    }),
  };

  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );

  return {
    listeners,
    setPrefersDark: (value: boolean) => {
      media.matches = value;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useResolvedColorMode", () => {
  it("keeps an explicit mode", () => {
    mockSystemPreference(true);

    const { result, rerender } = renderHook<WorkflowGraphColorMode, string>(
      useResolvedColorMode,
      "light",
    );

    expect(result.current).toBe("light");

    rerender("dark");

    expect(result.current).toBe("dark");
  });

  it("follows the system preference and its changes", () => {
    const system = mockSystemPreference(true);
    const { result } = renderHook(useResolvedColorMode, "system");

    expect(result.current).toBe("dark");

    system.setPrefersDark(false);

    expect(result.current).toBe("light");
  });

  it("stops listening once the mode is no longer system", () => {
    const system = mockSystemPreference(false);
    const { result, rerender, unmount } = renderHook<
      WorkflowGraphColorMode,
      string
    >(useResolvedColorMode, "system");

    expect(system.listeners.size).toBe(1);

    rerender("dark");

    expect(system.listeners.size).toBe(0);
    expect(result.current).toBe("dark");

    rerender("system");
    unmount();

    expect(system.listeners.size).toBe(0);
  });

  it("falls back to light without matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);

    const { result } = renderHook(useResolvedColorMode, "system");

    expect(result.current).toBe("light");
  });
});
