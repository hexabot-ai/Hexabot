/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createRoot, type Root } from "react-dom/client";

import ChatWidget from "./ChatWidget";
import { Config } from "./types/config.types";

/**
 * React is bundled here, so embedders have no `React`/`ReactDOM` global to
 * render with. `config` owns the root and hides the widget's React version.
 */

// Re-mounting must reuse the container's root; `createRoot` twice throws.
const roots = new WeakMap<Element, Root>();

export type MountHandle = {
  /** Unmounts the widget and releases its React root. */
  unmount: () => void;
};

export type ConfigOptions = Partial<Config> & {
  /** Element id, CSS selector, or element to mount into. */
  id: string | Element;
  /** Stylesheet URL, loaded into whichever root the widget renders in. */
  css?: string;
  /** Render inside a shadow root so the host page's CSS cannot leak in. */
  shadowDom?: boolean;
};

export function config({
  id,
  css,
  shadowDom,
  ...props
}: ConfigOptions): MountHandle {
  const host =
    typeof id === "string"
      ? (document.getElementById(id) ?? document.querySelector(id))
      : id;

  if (!host) throw new Error(`Hexabot widget: no element matching "${id}"`);

  // `attachShadow` throws if called twice, so re-mounting reuses the root.
  const shadowRoot = shadowDom
    ? (host.shadowRoot ?? host.attachShadow({ mode: "open" }))
    : null;
  // A shadow root does not inherit the page's styles, so the link goes inside.
  const styleTarget = shadowRoot ?? document.head;
  // Reuses the existing child on re-mount instead of stacking another one.
  const container =
    shadowRoot?.querySelector("div") ??
    shadowRoot?.appendChild(document.createElement("div")) ??
    host;

  if (css && !styleTarget.querySelector(`link[href="${css}"]`)) {
    const link = document.createElement("link");

    link.rel = "stylesheet";
    link.href = css;
    styleTarget.prepend(link);
  }

  let root = roots.get(container);

  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }

  root.render(<ChatWidget {...props} />);

  return {
    unmount: () => {
      root.unmount();
      roots.delete(container);
    },
  };
}

export { ChatWidget };
export type { Config };
