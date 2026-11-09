/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ThemeMode, ThemeOverrides } from "../theme/theme.types";

import { UiMessage } from "./message.types";
import { ConnectionState } from "./state.types";

export type ConfigTransport = "ws" | "polling";

/** A visitor the host page already knows. */
export type ConfigProfile = {
  firstName: string;
  lastName: string;
};

export type Config = {
  apiUrl: string;
  channel: string;
  sourceId: string;
  language: string;
  maxUploadSize: number;
  transport?: ConfigTransport;
  workflowId?: string;
  instanceId?: string;
  mode?: ThemeMode;
  theme?: ThemeOverrides;
  primaryColor?: string;
  /**
   * Subscribes the visitor under this name without showing the pre-chat
   * form. Ignored once the session already has a subscriber.
   */
  profile?: ConfigProfile;
  /**
   * Called for each message the socket delivers, sent or received. History
   * loaded on connect is not replayed.
   */
  onMessage?: (message: UiMessage) => void;
  /** Called with the connection state on mount and on every change. */
  onConnectionChange?: (state: ConnectionState) => void;
};
