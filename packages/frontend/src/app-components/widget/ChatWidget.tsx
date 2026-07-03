/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import UiChatWidget from "@hexabot-ai/widget/src/UiChatWidget";
import { Box, useColorScheme, useTheme } from "@mui/material";
import { memo, useCallback, useMemo } from "react";

import { useFind } from "@/hooks/crud/useFind";
import { useAppRouter } from "@/hooks/useAppRouter";
import { useAuth } from "@/hooks/useAuth";
import { useConfig } from "@/hooks/useConfig";
import i18n from "@/i18n/config";
import { EntityType, RouterType } from "@/services/types";

const HiddenLauncher = () => <span style={{ display: "none" }} />;
const HiddenHeader = () => null;

export const CONSOLE_CHANNEL_NAME = "console";

type ChatWidgetVariant = "launcher" | "embedded";

interface ChatWidgetProps {
  variant?: ChatWidgetVariant;
  workflowId?: string;
}

const ChatWidgetComponent = ({
  variant = "launcher",
  workflowId,
}: ChatWidgetProps) => {
  const { mode } = useColorScheme();
  const theme = useTheme();
  const { pathname, reload } = useAppRouter();
  const { apiUrl } = useConfig();
  const { isAuthenticated } = useAuth();
  const { data: sources = [] } = useFind(
    { entity: EntityType.SOURCE },
    {
      hasCount: false,
      params: {
        where: {
          channel: CONSOLE_CHANNEL_NAME,
          state: true,
        },
      },
    },
    {
      enabled: isAuthenticated,
    },
  );
  const isVisualEditor = pathname.startsWith(`/${RouterType.WORKFLOW_EDITOR}`);
  const isEmbedded = variant === "embedded";
  const selectedSource = useMemo(() => {
    if (!sources.length) {
      return undefined;
    }

    if (workflowId) {
      const sourceForWorkflow = sources.find(
        (source) => source.defaultWorkflow === workflowId,
      );

      if (sourceForWorkflow) {
        return sourceForWorkflow;
      }
    }

    return (
      sources.find((source) => source.defaultWorkflow == null) ?? sources[0]
    );
  }, [sources, workflowId]);
  const primaryColor = theme.palette.primary.main;
  const resolvedMode = mode ?? theme.palette.mode;
  const containerSx = useMemo(
    () => ({
      display: isEmbedded ? "flex" : isVisualEditor ? "block" : "none",
      width: isEmbedded ? "100%" : "auto",
      height: isEmbedded ? "100%" : "auto",
      minHeight: isEmbedded ? 0 : "auto",
      flex: isEmbedded ? 1 : "none",
      ...(isEmbedded
        ? {
            "& > *": {
              width: "100%",
              height: "100%",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            },
          }
        : {}),
    }),
    [isEmbedded, isVisualEditor],
  );
  const widgetConfig = useMemo(
    () => ({
      apiUrl,
      channel: selectedSource?.channel ?? CONSOLE_CHANNEL_NAME,
      sourceId: selectedSource?.id,
      language: i18n.language,
      primaryColor,
      mode: resolvedMode,
      workflowId,
    }),
    [
      apiUrl,
      i18n.language,
      primaryColor,
      resolvedMode,
      selectedSource?.channel,
      selectedSource?.id,
      workflowId,
    ],
  );
  const handleUnauthorized = useCallback(() => {
    reload();
  }, [reload]);
  const socketErrorHandlers = useMemo(
    () => ({
      "401": handleUnauthorized,
    }),
    [handleUnauthorized],
  );

  if (!isAuthenticated || !selectedSource?.id) {
    return null;
  }

  return (
    <Box sx={containerSx}>
      <UiChatWidget
        config={widgetConfig}
        CustomHeader={isEmbedded ? HiddenHeader : undefined}
        CustomLauncher={isEmbedded ? HiddenLauncher : undefined}
        defaultIsOpen={isEmbedded}
        socketErrorHandlers={socketErrorHandlers}
      />
    </Box>
  );
};

export const ChatWidget = memo(ChatWidgetComponent);
ChatWidget.displayName = "ChatWidget";
