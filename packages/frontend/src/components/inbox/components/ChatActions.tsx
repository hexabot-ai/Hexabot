/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Hand, Lock } from "lucide-react";
import { useEffect, useState } from "react";

import { Avatar } from "@/app-components/displays/Avatar";
import { useFind } from "@/hooks/crud/useFind";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";

import { useChat } from "../hooks/ChatContext";

export const ChatActions = () => {
  const { t } = useTranslate();
  const { thread, subscriber: activeChat } = useChat();
  const [takeoverBy, setTakeoverBy] = useState<string>(
    activeChat?.assignedTo ?? "",
  );
  const { mutate } = useUpdate(EntityType.SUBSCRIBER);
  const { mutate: updateThread } = useUpdate(EntityType.THREAD);
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: users } = useFind({
    entity: EntityType.USER,
  });

  useEffect(() => {
    setTakeoverBy(activeChat?.assignedTo ?? "");
  }, [activeChat?.assignedTo]);

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
      {users.length > 0 && (
        <Box minWidth={180}>
          <TextField
            fullWidth
            size="small"
            onChange={(e) => setTakeoverBy(e.target.value)}
            value={takeoverBy}
            disabled={!activeChat}
            label={t("label.assign_to")}
            select
          >
            {(users || []).map((chatUser) => {
              const displayName =
                `${chatUser.firstName} ${chatUser.lastName}`.trim() ||
                chatUser.email ||
                chatUser.id;

              return (
                <MenuItem key={chatUser.id} value={chatUser.id}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Avatar
                      alt={displayName}
                      size={24}
                      subscriberId={chatUser.id}
                    />
                    <Typography
                      variant="body2"
                      sx={{ textTransform: "capitalize" }}
                    >
                      {displayName}
                    </Typography>
                  </Stack>
                </MenuItem>
              );
            })}
          </TextField>
        </Box>
      )}
      <IconButton
        disabled={!activeChat}
        onClick={() =>
          activeChat &&
          takeoverBy &&
          mutate({
            id: activeChat.id,
            params: { assignedTo: takeoverBy },
          })
        }
        color="default"
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 1.5,
        }}
      >
        <Hand size={18} />
      </IconButton>
      <Button
        disabled={!activeChat}
        onClick={() =>
          activeChat &&
          mutate({
            id: activeChat.id,
            params: {
              assignedTo:
                user && user.id === activeChat.assignedTo ? null : user?.id,
            },
          })
        }
      >
        {user && user.id === activeChat?.assignedTo
          ? t("button.handback")
          : t("button.takeover")}
      </Button>
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
