/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { vi } from "vitest";

/**
 * Gives jsdom the layout APIs xyflow reads (element sizes, resize observers,
 * the viewport transform matrix), with fixed values so renders are
 * deterministic, and a controllable `prefers-color-scheme` media query.
 */
export const installXyflowDom = () => {
  const colorSchemeListeners = new Set<() => void>();
  let prefersDark = false;

  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      m22: number;

      constructor(transform?: string) {
        const scale = transform?.match(/scale\(([-\d.]+)\)/);

        this.m22 = scale ? Number(scale[1]) : 1;
      }
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn((media: string) => ({
      media,
      get matches() {
        return prefersDark;
      },
      addEventListener: (_type: string, listener: () => void) => {
        colorSchemeListeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        colorSchemeListeners.delete(listener);
      },
    })),
  );
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: { configurable: true, get: () => 1200 },
    offsetHeight: { configurable: true, get: () => 800 },
    clientWidth: { configurable: true, get: () => 1200 },
    clientHeight: { configurable: true, get: () => 800 },
  });

  return {
    setPrefersDark: (value: boolean) => {
      prefersDark = value;
      colorSchemeListeners.forEach((listener) => listener());
    },
  };
};
