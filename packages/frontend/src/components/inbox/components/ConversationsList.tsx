/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import debounce from "@mui/utils/debounce";
import { Inbox, Lock } from "lucide-react";
import { UIEventHandler, useCallback, useEffect } from "react";

import { useGetFromCache } from "@/hooks/crud/useGet";
import { useAppRouter } from "@/hooks/useAppRouter";
import { useTranslate } from "@/hooks/useTranslate";
import { Title } from "@/layout/content/Title";
import { EntityType, RouterType } from "@/services/types";
import { SearchPayload } from "@/types/search.types";
import { normalizeDate } from "@/utils/date";

import { useChat } from "../hooks/ChatContext";
import { useInfiniteLiveThreads } from "../hooks/useInfiniteLiveThreads";
import { AssignedTo } from "../types";

import { SubscriberAvatars } from "./SubscriberAvatars";

export const getActiveThreadId = (
  rawThread: string | string[] | undefined,
): string | null => {
  if (Array.isArray(rawThread)) {
    return rawThread.at(-1) || null;
  }

  return rawThread || null;
};

export const getInboxThreadPath = (threadId: string) => {
  return `/${RouterType.INBOX}/threads/${threadId}`;
};

export const getConversationSecondaryText = (
  firstValue: string | null | undefined,
  formattedDate?: string,
) => {
  return [firstValue, formattedDate].filter(Boolean).join(" • ");
};

export const getConversationSourceLabel = (
  sourceName: string | null | undefined,
  unknownLabel: string,
) => {
  return sourceName || unknownLabel;
};

export const ConversationsList = (props: {
  sources: string[];
  searchPayload: SearchPayload<EntityType.SUBSCRIBER>;
  assignedTo: AssignedTo;
}) => {
  const router = useAppRouter();
  const threadId = getActiveThreadId(router.query.thread);
  const { t, i18n } = useTranslate();
  const chat = useChat();
  const getSubscriberFromCache = useGetFromCache(EntityType.SUBSCRIBER);
  const getSourceFromCache = useGetFromCache(EntityType.SOURCE);
  const { fetchNextPage, isFetching, threads, hasNextPage } =
    useInfiniteLiveThreads(props);
  const handleLoadMore = debounce(() => {
    !isFetching && hasNextPage && fetchNextPage();
  }, 400);

  useEffect(() => {
    if (chat) {
      chat.setThreadId(threadId);
    }
  }, [threadId]);
  const handleScroll: UIEventHandler<HTMLUListElement> = useCallback(
    (event) => {
      const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;

      if (Math.ceil(scrollTop + clientHeight) >= scrollHeight) {
        handleLoadMore();
      }
    },
    [handleLoadMore],
  );

  return (
    <List
      onScroll={handleScroll}
      sx={{
        height: "100%",
        overflow: "auto",
        px: 1,
      }}
      subheader={
        <ListSubheader
          component="div"
          sx={{
            bgcolor: "background.paper",
          }}
        >
          <Title title={t(props.assignedTo)} Icon={Inbox} />
        </ListSubheader>
      }
    >
      {threads?.map((thread) => {
        const subscriber =
          typeof thread.subscriber === "string"
            ? getSubscriberFromCache(thread.subscriber)
            : thread.subscriber;
        const source =
          typeof thread.source === "string"
            ? getSourceFromCache(thread.source)
            : thread.source;
        const subscriberName = [subscriber?.firstName, subscriber?.lastName]
          .filter(Boolean)
          .join(" ");
        const threadTitle = thread.title?.trim();
        const primaryText = threadTitle || subscriberName || t("label.unknown");
        const formattedDate = normalizeDate(
          i18n.language,
          thread.lastMessageAt || thread.createdAt,
        );
        const sourceLabel = getConversationSourceLabel(
          source?.name,
          t("label.unknown"),
        );

        if (!subscriber) {
          return null;
        }

        return (
          <ListItem disablePadding key={thread.id} sx={{ mt: 0.5 }}>
            <ListItemButton
              selected={chat.thread?.id === thread.id}
              onClick={() => {
                chat.setThreadId(thread.id);
                router.push(getInboxThreadPath(thread.id));
              }}
            >
              <ListItemAvatar sx={{ minWidth: 32 }}>
                <SubscriberAvatars subscriber={subscriber} />
              </ListItemAvatar>
              <ListItemText
                primary={primaryText}
                secondary={getConversationSecondaryText(
                  threadTitle ? subscriberName : null,
                  formattedDate,
                )}
                slotProps={{
                  primary: {
                    variant: "body2",
                    noWrap: true,
                  },
                  secondary: {
                    variant: "caption",
                    noWrap: true,
                  },
                }}
              />
              <Stack direction="row" spacing={0.5} alignItems="center">
                {thread.status === "closed" && (
                  <Tooltip title={t("label.closed")}>
                    <Stack
                      component="span"
                      alignItems="center"
                      justifyContent="center"
                      aria-label={t("label.closed")}
                      sx={{ color: "text.secondary" }}
                    >
                      <Lock size={14} />
                    </Stack>
                  </Tooltip>
                )}
                <Chip
                  size="small"
                  label={sourceLabel}
                  aria-label={sourceLabel}
                />
              </Stack>
            </ListItemButton>
          </ListItem>
        );
      })}
    </List>
  );
};
