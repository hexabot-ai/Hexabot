/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  createContext,
  FC,
  ReactNode,
  useContext,
  useEffect,
  useRef,
} from "react";

export enum EBCEvent {
  LOGIN = "login",
  LOGOUT = "logout",
}

export type BroadcastChannelMessage = {
  event: `${EBCEvent}`;
  data?: string | number | boolean | Record<string, unknown> | undefined | null;
};

interface IBroadcastChannelProps {
  channelName: string;
  children: ReactNode;
}

interface IBroadcastChannelContext {
  subscribe: (
    event: `${EBCEvent}`,
    callback: (message: BroadcastChannelMessage) => void,
  ) => () => void;
  postMessage: (message: BroadcastChannelMessage) => void;
}

const BroadcastChannelContext = createContext<
  IBroadcastChannelContext | undefined
>(undefined);
const BroadcastChannelProvider: FC<IBroadcastChannelProps> = ({
  children,
  channelName,
}) => {
  // Hold a nullable ref; we’ll assign in the effect.
  const channelRef = useRef<BroadcastChannel | null>(null);
  const subscribersRef = useRef<
    Record<string, Array<Parameters<IBroadcastChannelContext["subscribe"]>[1]>>
  >({});

  useEffect(() => {
    // Guard for SSR / unsupported browsers
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
      return;
    }

    const ch = new BroadcastChannel(channelName);

    channelRef.current = ch;

    const handleMessage = ({ data }: MessageEvent<BroadcastChannelMessage>) => {
      subscribersRef.current[data.event]?.forEach((cb) => cb(data));
    };

    ch.addEventListener("message", handleMessage);

    return () => {
      ch.removeEventListener("message", handleMessage);
      ch.close();
      // If nothing else replaced it, null it out
      if (channelRef.current === ch) {
        channelRef.current = null;
      }
    };
  }, [channelName]);

  const ensureChannel = () => {
    if (!channelRef.current) {
      if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
        return null;
      }
      channelRef.current = new BroadcastChannel(channelName);
    }

    return channelRef.current;
  };
  const subscribe: IBroadcastChannelContext["subscribe"] = (
    event,
    callback,
  ) => {
    subscribersRef.current[event] ??= [];
    subscribersRef.current[event].push(callback);

    return () => {
      const list = subscribersRef.current[event];

      if (!list) return;
      const idx = list.indexOf(callback);

      if (idx !== -1) list.splice(idx, 1);
    };
  };
  const postMessage: IBroadcastChannelContext["postMessage"] = (message) => {
    const ch = ensureChannel();

    if (!ch) return;

    try {
      ch.postMessage(message);
    } catch (err: any) {
      // React dev/StrictMode or HMR can leave a closed instance around
      if (err?.name === "InvalidStateError") {
        const reopened = new BroadcastChannel(channelName);

        channelRef.current = reopened;
        reopened.postMessage(message);
      } else {
        throw err;
      }
    }
  };

  return (
    <BroadcastChannelContext.Provider value={{ subscribe, postMessage }}>
      {children}
    </BroadcastChannelContext.Provider>
  );
};

export const useBroadcastChannel = () => {
  const ctx = useContext(BroadcastChannelContext);

  if (!ctx) {
    throw new Error(
      "useBroadcastChannel must be used within a BroadcastChannelProvider",
    );
  }

  return ctx;
};

export default BroadcastChannelProvider;
