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
  LOGOUT = "logout",
  SUBSCRIBED = "subscribed",
}

type BroadcastChannelMessage = {
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
  ) => void;
  unsubscribe: (
    event: `${EBCEvent}`,
    callback: (message: BroadcastChannelMessage) => void,
  ) => void;
  postMessage: (message: BroadcastChannelMessage) => void;
}

export const BroadcastChannelContext = createContext<
  IBroadcastChannelContext | undefined
>(undefined);

export const BroadcastChannelProvider: FC<IBroadcastChannelProps> = ({
  children,
  channelName,
}) => {
  const channelRef = useRef<BroadcastChannel | undefined>(undefined);
  const subscribersRef = useRef<
    Record<
      string,
      Array<Parameters<IBroadcastChannelContext["subscribe"]>["1"]>
    >
  >({});

  useEffect(() => {
    const channel = new BroadcastChannel(channelName);

    channelRef.current = channel;

    const handleMessage = ({ data }: MessageEvent<BroadcastChannelMessage>) => {
      subscribersRef.current[data.event]?.forEach((cb) => cb(data));
    };

    channel.addEventListener("message", handleMessage);

    return () => {
      channel.removeEventListener("message", handleMessage);

      if (channelRef.current === channel) {
        channelRef.current = undefined;
      }

      channel.close();
    };
  }, [channelName]);

  const subscribe: IBroadcastChannelContext["subscribe"] = (
    event,
    callback,
  ) => {
    subscribersRef.current[event] ??= [];
    subscribersRef.current[event].push(callback);

    return () => {
      const index = subscribersRef.current[event].indexOf(callback);

      if (index !== -1) {
        subscribersRef.current[event].splice(index, 1);
      }
    };
  };
  const unsubscribe: IBroadcastChannelContext["unsubscribe"] = (
    event,
    callback,
  ) => {
    subscribersRef.current[event] = (
      subscribersRef.current?.[event] || []
    ).filter((cb) => {
      return cb !== callback;
    });
  };
  const postMessage: IBroadcastChannelContext["postMessage"] = (message) => {
    channelRef.current?.postMessage(message);
  };

  return (
    <BroadcastChannelContext.Provider
      value={{
        subscribe,
        unsubscribe,
        postMessage,
      }}
    >
      {children}
    </BroadcastChannelContext.Provider>
  );
};

export const useBroadcastChannel = () => {
  const context = useContext(BroadcastChannelContext);

  if (!context) {
    throw new Error(
      "useBroadcastChannel must be used within a BroadcastChannelProvider",
    );
  }

  return context;
};

export default BroadcastChannelProvider;
