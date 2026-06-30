/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import { Lock, UserRoundArrowLeft } from "lucide-react";

import { useFind } from "@/hooks/crud/useFind";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useAuth } from "@/hooks/useAuth";
import { useDialogs } from "@/hooks/useDialogs";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";

import { useChat } from "../hooks/ChatContext";

import { ChatHandoverDialog } from "./ChatHandoverDialog";

export const ChatActions = () => {
  const { t } = useTranslate();
  const { thread, subscriber: activeChat } = useChat();
  const { mutate } = useUpdate(EntityType.SUBSCRIBER);
  const { mutate: updateThread } = useUpdate(EntityType.THREAD);
  const { user } = useAuth();
  const dialogs = useDialogs();
  const { toast } = useToast();
  const { data: users } = useFind({
    entity: EntityType.USER,
  });
  const handleOpenHandoverDialog = async () => {
    const subscriber = activeChat;

    if (!subscriber || users.length === 0) return;

    const assignedTo = await dialogs.open(ChatHandoverDialog, {
      assignedTo: subscriber.assignedTo,
      currentUserId: user?.id,
      users,
    });

    if (!assignedTo || assignedTo === subscriber.assignedTo) return;

    mutate({
      id: subscriber.id,
      params: { assignedTo },
    });
  };
  const handleCloseThread = () => {
    if (!thread) return;

    updateThread(
      {
        id: thread.id,
        params: {
          status: "closed",
          closeReason: "manual",
          closedAt: new Date(),
        },
      },
      {
        onSuccess: () => {
          toast.success(t("message.thread_closed_success"));
        },
        onError: (error) => {
          toast.error(error);
        },
      },
    );
  };
  const isThreadClosed = thread?.status === "closed";

  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      justifyContent="flex-end"
      flexWrap="wrap"
      marginLeft="auto"
    >
      <Tooltip title={t("button.assign")}>
        <span>
          <IconButton
            aria-label={t("button.assign")}
            disabled={!activeChat || users.length === 0}
            onClick={() => {
              void handleOpenHandoverDialog();
            }}
          >
            <UserRoundArrowLeft size={18} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t("button.close_thread")}>
        <span>
          <IconButton
            aria-label={t("button.close_thread")}
            disabled={!activeChat || isThreadClosed}
            onClick={handleCloseThread}
          >
            <Lock size={18} />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
};
