/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowType } from "@hexabot-ai/types";
import {
  Box,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { alpha, styled, useTheme } from "@mui/material/styles";
import { getDefaultFormState, type RJSFSchema } from "@rjsf/utils";
import { MessageSquarePlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ChatWidget,
  CONSOLE_CHANNEL_NAME,
} from "@/app-components/widget/ChatWidget";
import { TriggerSimulatorPanel } from "@/components/workflow-run-debugger/components/panels/trigger-simulator-panel/TriggerSimulatorPanel";
import { WorkflowRunDebugger } from "@/components/workflow-run-debugger/components/WorkflowRunDebugger";
import { useFind } from "@/hooks/crud/useFind";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useAuth } from "@/hooks/useAuth";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";
import validator from "@/utils/rjsf-zod-validator";

import { useResizableDrawerSize } from "../../../../../hooks/useResizableDrawerSize";
import { useWorkflow } from "../../hooks/useWorkflow";

const defaultDrawerHeight = 380;
const minDrawerHeight = 160;
const drawerHeightStorageKey = "hexabot.visual_editor.bottom_drawer_height";
const columnDividerWidth = 16;
const minChatColumnWidth = 280;
const minDetailsColumnWidth = 240;
const defaultChatColumnRatio = 1 / 4;

interface BottomDrawerProps {
  drawerHeight: number;
}

interface DrawerBodyProps {
  chatColumnWidth: number | null;
  isStacked: boolean;
}

const BottomDrawer = styled(Drawer, {
  shouldForwardProp: (prop) => prop !== "drawerHeight",
})<BottomDrawerProps>(({ theme, drawerHeight }) => ({
  position: "relative",
  zIndex: theme.zIndex.appBar - 1,
  "& .MuiDrawer-paper": {
    height: drawerHeight,
    display: "flex",
    flexDirection: "column",
    position: "relative",
  },
}));
const DrawerBody = styled(Stack, {
  shouldForwardProp: (prop) =>
    prop !== "chatColumnWidth" && prop !== "isStacked",
})<DrawerBodyProps>(({ theme, chatColumnWidth, isStacked }) => ({
  display: "grid",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
  padding: theme.spacing(1.5),
  ...(isStacked
    ? {
        gridTemplateColumns: "1fr",
        gridTemplateRows: "repeat(2, minmax(0, 1fr))",
        rowGap: theme.spacing(2),
      }
    : {
        gridTemplateRows: "minmax(0, 1fr)",
        gridTemplateColumns: `${
          chatColumnWidth !== null ? `${chatColumnWidth}px` : "minmax(0, 1fr)"
        } ${columnDividerWidth}px ${
          chatColumnWidth !== null ? "minmax(0, 1fr)" : "minmax(0, 2fr)"
        }`,
      }),
}));
const DrawerColumn = styled(Stack)(() => ({
  minHeight: 0,
  minWidth: 0,
  overflow: "auto",
}));
const ChatWidgetColumn = styled(Paper)(() => ({
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  padding: 0,
  "& .hb-chat-window": {
    position: "relative",
    right: "auto !important",
    bottom: "auto !important",
    width: "100%",
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    borderRadius: 0,
    boxShadow: "none !important",
    zIndex: "auto !important",
  },
}));
const ChatPreviewHeader = styled(Stack)(({ theme }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  padding: theme.spacing(0.5, 0.75, 0.5, 1.5),
  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.06)",
  clipPath: "inset(0 0 -4px 0)",
  flexShrink: 0,
  zIndex: 1,
}));
const ChatWidgetBody = styled(Box)(() => ({
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
  position: "relative",
}));
const ColumnResizer = styled(Divider)(({ theme }) => ({
  width: "100%",
  height: "100%",
  cursor: "col-resize",
  display: "flex",
  justifyContent: "center",
  border: 0,
  position: "relative",
  "&::before": {
    content: '""',
    width: theme.spacing(0.5),
    borderRadius: theme.spacing(0.5),
    backgroundColor: alpha(theme.palette.primary.main, 0.25),
    opacity: 0,
    transition: theme.transitions.create("opacity", {
      duration: theme.transitions.duration.shortest,
    }),
  },
  "&:hover::before": {
    opacity: 1,
  },
}));
const DrawerResizer = styled(Divider)(({ theme }) => ({
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: theme.spacing(0.75),
  cursor: "row-resize",
  zIndex: 1,
  border: 0,
  "&::after": {
    content: '""',
    position: "absolute",
    top: theme.spacing(0.25),
    left: 0,
    right: 0,
    height: theme.spacing(0.25),
    backgroundColor: alpha(theme.palette.primary.main, 0.2),
    opacity: 0,
    transition: theme.transitions.create("opacity", {
      duration: theme.transitions.duration.shortest,
    }),
  },
  "&:hover::after": {
    opacity: 1,
  },
}));
const getDefaultManualInput = (schema?: unknown): Record<string, unknown> => {
  if (!schema || typeof schema !== "object") {
    return {};
  }

  try {
    return (getDefaultFormState(
      validator,
      schema as RJSFSchema,
      undefined,
      schema as RJSFSchema,
      false,
      {
        emptyObjectFields: "skipEmptyDefaults",
      },
    ) ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
};
const drawerId = "workflow-bottom-drawer";
const clampChatColumnWidth = (width: number, containerWidth: number) => {
  const maxWidth = Math.max(
    minChatColumnWidth,
    containerWidth - columnDividerWidth - minDetailsColumnWidth,
  );

  return Math.min(Math.max(width, minChatColumnWidth), maxWidth);
};
const getDefaultChatColumnWidth = (containerWidth: number) =>
  clampChatColumnWidth(
    Math.round((containerWidth - columnDividerWidth) * defaultChatColumnRatio),
    containerWidth,
  );

export const WorkflowBottomDrawer = () => {
  const { t } = useTranslate();
  const theme = useTheme();
  const { workflow } = useWorkflow();
  const { user } = useAuth();
  const isConversationalWorkflow =
    workflow?.type === WorkflowType.conversational;
  const isStacked = useMediaQuery(theme.breakpoints.down("md"));
  const { size: drawerHeight, handleResizeStart } = useResizableDrawerSize({
    sizeStorageKey: drawerHeightStorageKey,
    defaultSize: defaultDrawerHeight,
    minSize: minDrawerHeight,
    axis: "vertical",
  });
  const [chatKey, setChatKey] = useState(0);
  const { data: consoleSources, isLoading: isLoadingConsoleSources } = useFind(
    { entity: EntityType.SOURCE },
    {
      hasCount: false,
      params: { where: { channel: CONSOLE_CHANNEL_NAME, state: true } },
    },
    { enabled: isConversationalWorkflow },
  );
  const selectedSourceId = useMemo(() => {
    if (!consoleSources?.length) return undefined;
    const match = consoleSources.find(
      (s) => s.defaultWorkflow === workflow?.id,
    );

    return (
      match ??
      consoleSources.find((s) => !s.defaultWorkflow) ??
      consoleSources[0]
    )?.id;
  }, [consoleSources, workflow?.id]);
  const { data: latestOpenThreads, isLoading: isLoadingThreads } = useFind(
    { entity: EntityType.THREAD },
    {
      hasCount: false,
      params: {
        where: { "source.id": selectedSourceId, status: "open" },
      },
      initialSortState: [{ field: "lastMessageAt", sort: "desc" }],
      initialPaginationState: { page: 0, pageSize: 1 },
    },
    { enabled: !!selectedSourceId && isConversationalWorkflow },
  );
  const currentThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentThreadIdRef.current = latestOpenThreads?.[0]?.id ?? null;
  }, [latestOpenThreads]);

  const { mutateAsync: closeThread, isPending: isClosingThread } = useUpdate(
    EntityType.THREAD,
  );
  const isNewThreadDisabled =
    isLoadingConsoleSources || isLoadingThreads || isClosingThread;
  const handleNewThread = useCallback(async () => {
    const threadId = currentThreadIdRef.current;

    currentThreadIdRef.current = null;
    if (threadId) {
      try {
        await closeThread({
          id: threadId,
          params: {
            status: "closed",
            closeReason: "manual",
            closedAt: new Date(),
          },
        });
      } catch {
        // proceed with reset even if close fails
      }
    }
    setChatKey((prev) => prev + 1);
  }, [closeThread]);
  const [workflowInput, setWorkflowInput] = useState<Record<string, unknown>>(
    {},
  );
  const drawerBodyRef = useRef<HTMLDivElement | null>(null);
  const {
    size: chatColumnWidthSize,
    setSize: setChatColumnWidth,
    handleResizeStart: handleColumnResizeStart,
  } = useResizableDrawerSize({
    sizeStorageKey: "hexabot.visual_editor.bottom_drawer_column_width",
    // 0 is the sentinel for "fluid / not yet dragged"
    defaultSize: 0,
    minSize: minChatColumnWidth,
    maxSize: () => {
      const containerWidth = drawerBodyRef.current?.clientWidth ?? 0;

      if (!containerWidth) return undefined;

      return Math.max(
        minChatColumnWidth,
        containerWidth - columnDividerWidth - minDetailsColumnWidth,
      );
    },
    axis: "horizontal",
    onResizeStart: (initialSize) => {
      if (initialSize === 0) {
        const containerWidth = drawerBodyRef.current?.clientWidth ?? 0;

        setChatColumnWidth(getDefaultChatColumnWidth(containerWidth));
      }
    },
  });
  // null = fluid (grid auto-sizing); number = fixed px width chosen by user
  const chatColumnWidth = chatColumnWidthSize > 0 ? chatColumnWidthSize : null;

  useEffect(() => {
    if (workflow?.type !== WorkflowType.manual) {
      setWorkflowInput({});

      return;
    }

    setWorkflowInput(getDefaultManualInput(workflow.inputSchema));
  }, [workflow?.id, workflow?.inputSchema, workflow?.type]);

  useEffect(() => {
    const element = drawerBodyRef.current;

    if (!element || typeof window === "undefined") {
      return;
    }

    const applyWidth = (containerWidth: number) => {
      if (!containerWidth) return;

      setChatColumnWidth((prev) =>
        prev > 0 ? clampChatColumnWidth(prev, containerWidth) : 0,
      );
    };

    if (typeof ResizeObserver === "undefined") {
      const handleResize = () => applyWidth(element.clientWidth);

      window.addEventListener("resize", handleResize);
      handleResize();

      return () => {
        window.removeEventListener("resize", handleResize);
      };
    }

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? element.clientWidth;

      applyWidth(nextWidth);
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [clampChatColumnWidth]);

  return (
    <BottomDrawer
      anchor="bottom"
      variant="permanent"
      id={drawerId}
      drawerHeight={drawerHeight}
    >
      <DrawerResizer
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("visual_editor.flows_drawer.resize")}
      />
      <DrawerBody
        ref={drawerBodyRef}
        isStacked={isStacked}
        chatColumnWidth={chatColumnWidth}
      >
        {isConversationalWorkflow ? (
          <ChatWidgetColumn
            variant="spaced"
            data-tour-id="admin-workflow-tour-chat-widget"
            onWheelCapture={(event) => {
              event.stopPropagation();
            }}
            onTouchMoveCapture={(event) => {
              event.stopPropagation();
            }}
          >
            <ChatPreviewHeader>
              <Typography variant="body2" fontWeight={600} noWrap>
                {t("visual_editor.chat_widget.preview_conversation")}
              </Typography>
              <Tooltip title={t("visual_editor.chat_widget.new_thread")}>
                <span>
                  <IconButton
                    onClick={handleNewThread}
                    disabled={isNewThreadDisabled}
                    aria-label={t("visual_editor.chat_widget.new_thread")}
                  >
                    {isClosingThread ? (
                      <CircularProgress size={24} thickness={5} />
                    ) : (
                      <MessageSquarePlus />
                    )}
                  </IconButton>
                </span>
              </Tooltip>
            </ChatPreviewHeader>
            <ChatWidgetBody>
              <ChatWidget
                key={chatKey}
                variant="embedded"
                workflowId={workflow?.id}
              />
            </ChatWidgetBody>
          </ChatWidgetColumn>
        ) : (
          <DrawerColumn
            onWheelCapture={(event) => {
              event.stopPropagation();
            }}
            onTouchMoveCapture={(event) => {
              event.stopPropagation();
            }}
          >
            <TriggerSimulatorPanel
              workflow={workflow}
              formData={workflowInput}
              onFormDataChange={setWorkflowInput}
            />
          </DrawerColumn>
        )}
        {!isStacked && (
          <ColumnResizer
            onMouseDown={handleColumnResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label={t("visual_editor.flows_drawer.resize")}
          />
        )}
        <DrawerColumn>
          <WorkflowRunDebugger workflow={workflow} initiatorId={user?.id} />
        </DrawerColumn>
      </DrawerBody>
    </BottomDrawer>
  );
};
