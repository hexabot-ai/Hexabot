/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import React, { useCallback, useState } from "react";

import { useTranslation } from "../hooks/useTranslation";
import { preprocessMessages, useChat } from "../providers/ChatProvider";
import { useConfig } from "../providers/ConfigProvider";
import { useSettings } from "../providers/SettingsProvider";
import { useSocket } from "../providers/SocketProvider";
import { ConnectionState } from "../types/state.types";
import { SocketIoClientError } from "../utils/SocketIoClientError";
import "./UserSubscription.scss";

const UserSubscription: React.FC = () => {
  const { t } = useTranslation();
  const { socketErrorHandlers } = useSocket();
  const { socket } = useSocket();
  const settings = useSettings();
  const { apiUrl } = useConfig();
  const {
    setMessages,
    connectionState,
    setConnectionState,
    participants,
    setParticipants,
    setSuggestions,
    subscribe,
    sendGetStarted,
  } = useChat();
  const [firstName, setFirstName] = useState<string>("");
  const [lastName, setLastName] = useState<string>("");
  const handleSubmit = useCallback(
    async ({
      event,
      first_name = "",
      last_name = "",
    }: {
      event?: React.FormEvent<HTMLFormElement>;
      first_name?: string;
      last_name?: string;
    }) => {
      event?.preventDefault();
      try {
        setConnectionState(ConnectionState.tryingToConnect);
        const { messages, profile } = await subscribe(
          first_name || firstName,
          last_name || lastName,
        );
        const { quickReplies, arrangedMessages, participantsList } =
          preprocessMessages(messages, participants, profile, apiUrl);

        setSuggestions(quickReplies);
        setMessages(arrangedMessages);
        setParticipants(participantsList);
        if (messages.length === 0) {
          await sendGetStarted(profile.foreignId);
        }
        setConnectionState(ConnectionState.connected);
      } catch (error) {
        if (
          error instanceof SocketIoClientError &&
          socketErrorHandlers?.[error.statusCode]
        ) {
          socketErrorHandlers[error.statusCode](error);
        } else {
          setConnectionState(ConnectionState.error);
          // eslint-disable-next-line no-console
          console.error("Unable to subscribe user", error);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      firstName,
      lastName,
      participants,
      setConnectionState,
      setMessages,
      setParticipants,
      socket,
    ],
  );

  return (
    <div className="user-subscription-wrapper">
      <form
        className="user-subscription"
        onSubmit={(event) => handleSubmit({ event })}
      >
        <div className="user-subscription-title">
          {settings.greetingMessage}
        </div>
        <div className="user-subscription-form">
          <input
            disabled={connectionState === ConnectionState.tryingToConnect}
            className="user-subscription-form-input"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder={t("user_subscription.first_name")}
            required
          />
          <input
            disabled={connectionState === ConnectionState.tryingToConnect}
            className="user-subscription-form-input"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder={t("user_subscription.last_name")}
            required
          />
          <button
            type="submit"
            disabled={connectionState === ConnectionState.tryingToConnect}
            className="user-subscription-form-button-submit"
          >
            {t("user_subscription.get_started")}
          </button>
        </div>
      </form>
    </div>
  );
};

export default UserSubscription;
