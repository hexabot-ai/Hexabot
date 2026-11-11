/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { useEffect } from "react";

import {
  BroadcastChannelEvent,
  BroadcastChannelMessage,
  useBroadcastChannel,
} from "@/contexts/broadcast-channel.context";

export const useSubscribeBroadcastChannel = (
  event: BroadcastChannelEvent,
  callback: (message: BroadcastChannelMessage) => void,
) => {
  const { subscribe } = useBroadcastChannel();

  useEffect(() => {
    return subscribe(event, callback);
  }, [callback, event, subscribe]);
};
