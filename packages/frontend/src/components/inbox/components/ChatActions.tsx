/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import { Lock, UserRoundArrowLeft, UserRoundMinus } from "lucide-react";

import LicenseGate, {
  hasLicensePlanAccess,
  PaidPlan,
} from "@/components/license/LicenseGate";
import { useFind } from "@/hooks/crud/useFind";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useAuth } from "@/hooks/useAuth";
import { useDialogs } from "@/hooks/useDialogs";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";

import { useChat } from "../hooks/ChatContext";

import { ChatHandoverDialog } from "./ChatHandoverDialog";

const USER_MANAGEMENT_REQUIRED_PLAN: PaidPlan = "pro";

export const ChatActions = () => {
  const { t } = useTranslate();
  const { thread, subscriber: activeChat } = useChat();
  const { user } = useAuth();
  const dialogs = useDialogs();
  const { toast } = useToast();
  const { mutate: updateSubscriber, isPending: isUpdatingSubscriber } =
    useUpdate(EntityType.SUBSCRIBER, {
      onError: (error) => {
        toast.error(error);
      },
    });
  const { mutate: updateThread } = useUpdate(EntityType.THREAD);
  const canAccessUserManagement = hasLicensePlanAccess(
    user?.license,
    USER_MANAGEMENT_REQUIRED_PLAN,
  );
  const {
    data: users,
    isError: hasUsersError,
    isFetching: isFetchingUsers,
  } = useFind(
    {
      entity: EntityType.USER,
    },
    {
      hasCount: false,
    },
    {
      enabled: canAccessUserManagement,
    },
  );
  const handleOpenHandoverDialog = async () => {
    const subscriber = activeChat;

    if (!canAccessUserManagement || !subscriber || users.length === 0) return;

    const assignedTo = await dialogs.open(ChatHandoverDialog, {
      assignedTo: subscriber.assignedTo,
      currentUserId: user?.id,
      users,
    });
    const currentAssignedTo = subscriber.assignedTo ?? null;

    if (assignedTo === undefined || assignedTo === currentAssignedTo) {
      return;
    }

    updateSubscriber({
      id: subscriber.id,
      params: { assignedTo },
    });
  };
  const handleUnassignConversation = () => {
    const subscriber = activeChat;

    if (!canAccessUserManagement || !subscriber?.assignedTo) return;

    updateSubscriber({
      id: subscriber.id,
      params: { assignedTo: null },
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
  const assignButtonDisabled =
    !activeChat ||
    isUpdatingSubscriber ||
    isFetchingUsers ||
    hasUsersError ||
    users.length === 0;
  const assignButtonTooltip = isUpdatingSubscriber
    ? t("message.loading")
    : isFetchingUsers
      ? t("message.loading")
      : hasUsersError
        ? t("message.assign_conversation_users_load_failed")
        : users.length === 0
          ? t("message.assign_conversation_no_users")
          : t("button.assign");
  const unassignButtonDisabled =
    !activeChat || !activeChat.assignedTo || isUpdatingSubscriber;
  const unassignButtonTooltip = isUpdatingSubscriber
    ? t("message.loading")
    : activeChat?.assignedTo
      ? t("button.unassign")
      : t("message.assign_conversation_not_assigned");
  const assignButton = (
    <IconButton
      aria-label={t("button.assign")}
      disabled={assignButtonDisabled}
      onClick={() => {
        void handleOpenHandoverDialog();
      }}
    >
      {isFetchingUsers || isUpdatingSubscriber ? (
        <CircularProgress color="inherit" size={18} />
      ) : (
        <UserRoundArrowLeft size={18} />
      )}
    </IconButton>
  );
  const unassignButton = (
    <IconButton
      aria-label={t("button.unassign")}
      disabled={unassignButtonDisabled}
      onClick={handleUnassignConversation}
    >
      {isUpdatingSubscriber ? (
        <CircularProgress color="inherit" size={18} />
      ) : (
        <UserRoundMinus size={18} />
      )}
    </IconButton>
  );

  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      justifyContent="flex-end"
      flexWrap="wrap"
      marginLeft="auto"
    >
      {canAccessUserManagement ? (
        <>
          <Tooltip title={assignButtonTooltip}>
            <span>{assignButton}</span>
          </Tooltip>
          <Tooltip title={unassignButtonTooltip}>
            <span>{unassignButton}</span>
          </Tooltip>
        </>
      ) : (
        <>
          <LicenseGate
            requiredPlan={USER_MANAGEMENT_REQUIRED_PLAN}
            reasonText={t("message.assign_conversation_locked")}
          >
            {assignButton}
          </LicenseGate>
          <LicenseGate
            requiredPlan={USER_MANAGEMENT_REQUIRED_PLAN}
            reasonText={t("message.assign_conversation_locked")}
          >
            {unassignButton}
          </LicenseGate>
        </>
      )}
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
