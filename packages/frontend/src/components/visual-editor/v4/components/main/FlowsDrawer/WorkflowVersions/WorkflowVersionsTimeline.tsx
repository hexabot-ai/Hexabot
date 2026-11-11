/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowVersion } from "@hexabot-ai/types";
import { Timeline } from "@mui/lab";

import {
  WorkflowVersionItem,
  type WorkflowVersionItemProps,
} from "./WorkflowVersionItem";

type WorkflowVersionsTimelineProps = Omit<
  WorkflowVersionItemProps,
  "version" | "index" | "total"
> & {
  versions: WorkflowVersion[];
};

export const WorkflowVersionsTimeline = ({
  versions,
  ...itemProps
}: WorkflowVersionsTimelineProps) => (
  <Timeline sx={{ m: 0, p: 0 }}>
    {versions.map((version, index) => (
      <WorkflowVersionItem
        key={version.id}
        version={version}
        index={index}
        total={versions.length}
        {...itemProps}
      />
    ))}
  </Timeline>
);
