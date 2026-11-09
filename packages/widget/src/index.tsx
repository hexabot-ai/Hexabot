/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Root } from "react-dom/client";
import * as ReactDOMClient from "react-dom/client";

import ChatWidget from "./ChatWidget";
import { Config, ConfigProfile } from "./types/config.types";
import UiChatWidget from "./UiChatWidget";

/**
 * The embed script renders with whichever React the host page loaded, so this
 * file may not assume a version. `createRoot` is the one mount API v18 and v19
 * agree on: v18 puts it on the single `ReactDOM` UMD global, v19 dropped the
 * legacy `render` it would otherwise fall back to.
 */

export type WidgetHandle = {
  /** Builds the widget on first call and makes it visible. */
  show: () => void;
  /** Hides the widget without discarding its state. */
  hide: () => void;
  /** Unmounts the widget and releases its React root. */
  destroy: () => void;
};

export type ConfigOptions = Partial<Config> & {
  /** Element id, CSS selector, or element to mount into. */
  id: string | Element;
  /** Stylesheet URL, loaded into whichever root the widget renders in. */
  css?: string;
  /** Render inside a shadow root so the host page's CSS cannot leak in. */
  shadowDom?: boolean;
};

// Re-mounting must reuse the container's root; mounting twice warns and leaks.
const roots = new WeakMap<Element, Root>();
const createWidgetRoot = (container: Element): Root => {
  // Catches a pre-v18 global, which has enough of React for this file to load
  // but no `createRoot` to mount with. A page missing React outright fails
  // earlier than this, while the bundle is still initializing.
  if (typeof ReactDOMClient.createRoot !== "function") {
    throw new Error(
      "Hexabot widget: no `createRoot` found. Load react and react-dom (v18 or v19) before this script.",
    );
  }

  return ReactDOMClient.createRoot(container);
};

function config({ id, css, shadowDom, ...props }: ConfigOptions): WidgetHandle {
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

  let mounted = false;
  let destroyed = false;
  const initiallyHidden = container.hasAttribute("hidden");
  const show = () => {
    if (destroyed) return;
    if (!root) {
      root = createWidgetRoot(container);
      roots.set(container, root);
    }
    if (!mounted) {
      root.render(<ChatWidget {...props} />);
      mounted = true;
    }
    container.removeAttribute("hidden");
  };
  const hide = () => {
    if (destroyed) return;
    container.setAttribute("hidden", "");
  };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (mounted) root?.unmount();
    roots.delete(container);
    if (initiallyHidden) {
      container.setAttribute("hidden", "");
    } else {
      container.removeAttribute("hidden");
    }
    root = undefined;
    mounted = false;
  };

  return { show, hide, destroy };
}

// Named exports are the package's ESM surface. They also shape the UMD global,
// which is the module namespace: embedders call `HexabotWidget.config(...)`, or
// render `HexabotWidget.ChatWidget` with the host page's React directly.
export { ChatWidget, config, UiChatWidget };
// The default stays callable as a React component while carrying the complete
// namespace for legacy `HexabotWidget` and modern named-export compatibility.
export default Object.assign(ChatWidget, {
  ChatWidget,
  config,
  UiChatWidget,
});
export type { Config, ConfigProfile };
