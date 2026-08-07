/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  TimelineConnector,
  TimelineContent,
  TimelineDot,
  TimelineItem,
  TimelineSeparator,
} from "@mui/lab";
import { Box, Paper, Typography } from "@mui/material";
import { type ReactElement } from "react";

interface DashboardTimelineItemProps {
  time: string | null;
  text?: string;
  secondaryText?: string;
  onClick?: () => void;
  renderTitle: () => ReactElement;
}
export const DashboardTimelineItem = ({
  time = "",
  renderTitle,
  secondaryText,
  text = "",
  onClick,
}: DashboardTimelineItemProps) => (
  <TimelineItem>
    <TimelineSeparator>
      <TimelineDot />
      <TimelineConnector />
    </TimelineSeparator>
    <TimelineContent>
      {time ? <Typography>{time}</Typography> : null}
      <Paper onClick={onClick}>
        {renderTitle()}
        <Typography>{text}</Typography>
        <Box>
          {secondaryText ? <Typography>{secondaryText}</Typography> : null}
        </Box>
      </Paper>
    </TimelineContent>
  </TimelineItem>
);
