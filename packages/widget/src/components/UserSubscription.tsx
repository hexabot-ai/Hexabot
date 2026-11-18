/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import React, { useState } from "react";

import { useTranslation } from "../hooks/useTranslation";
import { useChat } from "../providers/ChatProvider";
import { useSettings } from "../providers/SettingsProvider";
import { ConnectionState } from "../types/state.types";
import "./UserSubscription.scss";

const UserSubscription: React.FC = () => {
  const { t } = useTranslation();
  const settings = useSettings();
  const { connectionState, handleSubscription, sendGetStarted } = useChat();
  const [firstName, setFirstName] = useState<string>("");
  const [lastName, setLastName] = useState<string>("");
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const subscription = await handleSubscription(firstName, lastName);

    // Starts the conversation, unless the visitor already has one.
    if (subscription?.messages.length === 0) {
      await sendGetStarted(subscription.profile.foreignId);
    }
  };

  return (
    <div className="user-subscription-wrapper">
      <form className="user-subscription" onSubmit={handleSubmit}>
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
