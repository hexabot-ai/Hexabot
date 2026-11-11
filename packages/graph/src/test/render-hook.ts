/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

// Lets React flush updates inside act() without warnings (jsdom tests only).
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** Renders a hook inside a probe component and exposes its latest result. */
export const renderHook = <Props, Result>(
  hook: (props: Props) => Result,
  initialProps: Props,
) => {
  const result = { current: undefined as Result };
  const Probe = ({ props }: { props: Props }) => {
    result.current = hook(props);

    return null;
  };
  const root = createRoot(document.createElement("div"));
  const rerender = (props: Props) => {
    act(() => {
      root.render(createElement(Probe, { props }));
    });
  };

  rerender(initialProps);

  return {
    result,
    rerender,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
};
