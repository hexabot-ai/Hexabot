/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { alpha } from "@mui/material/styles";
import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";

import { MessageListProps, MessageListRef } from "./types";

interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  atBottom: boolean;
}

function collectMetrics(element: HTMLDivElement): ScrollMetrics {
  const atBottom =
    Math.abs(
      element.scrollHeight - (element.scrollTop + element.clientHeight),
    ) <= 1;

  return {
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    atBottom,
  };
}

export const MessageList = forwardRef<MessageListRef, MessageListProps>(
  function MessageList(
    {
      children,
      typingIndicator,
      loading = false,
      loadingMore = false,
      loadingMorePosition = "top",
      onYReachStart,
      onYReachEnd,
      className,
      disableOnYReachWhenNoScroll = false,
      scrollBehavior = "auto",
      autoScrollToBottom = true,
      autoScrollToBottomOnMount = true,
      ...rest
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const metricsRef = useRef<ScrollMetrics | null>(null);
    const mountedRef = useRef(false);
    const reachedStartRef = useRef(false);
    const reachedEndRef = useRef(false);
    const scrollToBottom = useCallback(
      (behavior: "auto" | "smooth" = scrollBehavior) => {
        const element = containerRef.current;

        if (!element) return;

        if (typeof element.scrollTo === "function") {
          element.scrollTo({ top: element.scrollHeight, behavior });
        } else {
          element.scrollTop = element.scrollHeight;
        }

        metricsRef.current = collectMetrics(element);
      },
      [scrollBehavior],
    );

    useImperativeHandle(
      ref,
      () => ({
        scrollToBottom,
      }),
      [scrollToBottom],
    );

    const handleScroll = useCallback(() => {
      const element = containerRef.current;

      if (!element) return;

      const metrics = collectMetrics(element);

      metricsRef.current = metrics;

      const isScrollable = element.scrollHeight > element.clientHeight + 1;
      const canEmitReachEvents = !(
        disableOnYReachWhenNoScroll && !isScrollable
      );
      const isAtTop = element.scrollTop <= 0;
      const isAtBottom = metrics.atBottom;

      if (isAtTop && canEmitReachEvents) {
        if (!reachedStartRef.current) {
          reachedStartRef.current = true;
          onYReachStart?.(element);
        }
      } else {
        reachedStartRef.current = false;
      }

      if (isAtBottom && canEmitReachEvents) {
        if (!reachedEndRef.current) {
          reachedEndRef.current = true;
          onYReachEnd?.(element);
        }
      } else {
        reachedEndRef.current = false;
      }
    }, [disableOnYReachWhenNoScroll, onYReachEnd, onYReachStart]);

    useLayoutEffect(() => {
      const element = containerRef.current;

      if (!element) return;

      if (!mountedRef.current) {
        mountedRef.current = true;

        if (autoScrollToBottomOnMount) {
          scrollToBottom(scrollBehavior);
        }

        metricsRef.current = collectMetrics(element);

        return;
      }

      const previousMetrics = metricsRef.current || collectMetrics(element);
      const currentMetrics = collectMetrics(element);
      const heightDelta =
        currentMetrics.scrollHeight - previousMetrics.scrollHeight;

      if (heightDelta !== 0) {
        if (previousMetrics.atBottom && autoScrollToBottom) {
          scrollToBottom(scrollBehavior);
        } else if (previousMetrics.scrollTop <= 1 && heightDelta > 0) {
          element.scrollTop = previousMetrics.scrollTop + heightDelta;
        }
      }

      metricsRef.current = collectMetrics(element);
    }, [
      autoScrollToBottom,
      autoScrollToBottomOnMount,
      children,
      loading,
      loadingMore,
      scrollBehavior,
      scrollToBottom,
      typingIndicator,
    ]);

    return (
      <Box
        className={className}
        sx={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          minHeight: "1.25em",
          position: "relative",
          bgcolor: "background.paper",
          color: "text.primary",
        }}
        {...rest}
      >
        {loadingMore && (
          <Box
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              zIndex: 2,
              display: "flex",
              justifyContent: "center",
              py: 0.2,
              bgcolor: "background.paper",
              ...(loadingMorePosition === "bottom"
                ? { bottom: 0 }
                : { top: 0 }),
            }}
          >
            <CircularProgress size={18} thickness={5} />
          </Box>
        )}

        {loading && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: (theme) =>
                alpha(
                  theme.palette.background.paper,
                  theme.palette.mode === "dark" ? 0.55 : 0.65,
                ),
              backdropFilter: "blur(1px)",
            }}
          >
            <CircularProgress size={28} thickness={5} />
          </Box>
        )}

        <Box
          ref={containerRef}
          onScroll={handleScroll}
          sx={{
            position: "absolute",
            inset: 0,
            overflowY: "auto",
            overflowX: "hidden",
            px: 1.5,
            py: 0.5,
            overscrollBehaviorY: "none",
            pb: typingIndicator ? 6 : 0.5,
          }}
        >
          {children}
        </Box>

        {typeof typingIndicator !== "undefined" && (
          <Box
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              px: 1,
              py: 0.6,
              bgcolor: "background.paper",
              borderTop: (theme) => `1px solid ${theme.palette.divider}`,
            }}
          >
            {typingIndicator}
          </Box>
        )}
      </Box>
    );
  },
);

MessageList.displayName = "MessageList";
