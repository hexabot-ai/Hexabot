/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { FormDialog } from "@/app-components/dialogs";
import { Avatar } from "@/app-components/displays/Avatar";
import { useTranslate } from "@/hooks/useTranslate";
import type { DialogProps } from "@/types/common/dialogs.types";
import type { User } from "@/types/user.types";

export type ChatHandoverDialogPayload = {
  assignedTo?: string | null;
  currentUserId?: string;
  users: User[];
};

export type ChatHandoverDialogResult = string | null;

const getDisplayName = (chatUser: User) =>
  `${chatUser.firstName} ${chatUser.lastName}`.trim() ||
  chatUser.email ||
  chatUser.id;

export const ChatHandoverDialog = ({
  payload,
  open,
  onClose,
}: DialogProps<ChatHandoverDialogPayload, ChatHandoverDialogResult>) => {
  const { t } = useTranslate();
  const initialAssignee =
    payload.assignedTo &&
    payload.users.some((chatUser) => chatUser.id === payload.assignedTo)
      ? payload.assignedTo
      : "";
  const [assignedTo, setAssignedTo] = useState(initialAssignee);
  const currentUser = payload.users.find(
    (chatUser) => chatUser.id === payload.currentUserId,
  );
  const sortedUsers = currentUser
    ? [
        currentUser,
        ...payload.users.filter((chatUser) => chatUser.id !== currentUser.id),
      ]
    : payload.users;
  const handleCancel = () => {
    void onClose(null);
  };
  const handleSubmit = () => {
    void onClose(assignedTo || null);
  };

  return (
    <FormDialog
      open={open}
      title={t("title.assign_conversation")}
      maxWidth="xs"
      onClose={handleCancel}
      onSubmit={handleSubmit}
      confirmButtonProps={{
        disabled: !assignedTo,
        value: "button.assign",
      }}
    >
      <TextField
        autoFocus
        fullWidth
        label={t("label.assign_to")}
        onChange={(event) => setAssignedTo(event.target.value)}
        select
        value={assignedTo}
      >
        {sortedUsers.map((chatUser) => {
          const displayName = getDisplayName(chatUser);
          const isCurrentUser = chatUser.id === payload.currentUserId;

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
                  component="span"
                  sx={{
                    "& .chat-user-display-name": {
                      textTransform: "capitalize",
                    },
                  }}
                >
                  <span className="chat-user-display-name">{displayName}</span>
                  {isCurrentUser ? ` (${t("label.me")})` : null}
                </Typography>
              </Stack>
            </MenuItem>
          );
        })}
      </TextField>
    </FormDialog>
  );
};
