/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { LucideIcon } from "lucide-react";
import React from "react";

import { useTranslation } from "../hooks/useTranslation";
import { useChat } from "../providers/ChatProvider";
import { ConnectionState } from "../types/state.types";

import { LoadingComponent } from "./LoadingComponent";
import "./ScreenTemplate.scss";

const Template: React.FC<{ name: string; Icon: LucideIcon }> = ({
  name,
  Icon,
}) => {
  const { t } = useTranslation();
  const { connectionState, reconnect } = useChat();
  const handleClick = () => {
    void reconnect();
  };
  const loading = connectionState === ConnectionState.tryingToConnect;

  return (
    <div className={`hb-chat--${name}-icon-wrapper`}>
      {loading ? (
        <LoadingComponent />
      ) : (
        <div className={`hb-chat--${name}-icon`}>
          <Icon width="100" height="100" x="0" y="0" />
          <h3 className={`hb-chat--${name}-text`}>{t(`settings.${name}`)}</h3>
          <button className={`hb-chat--${name}-button`} onClick={handleClick}>
            {t("user_subscription.refresh")}
          </button>
        </div>
      )}
    </div>
  );
};

export default Template;
