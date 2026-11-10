/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { Plus } from "lucide-react";
import { useMemo } from "react";

import { useWorkflowGraphHost } from "../../contexts/workflow-graph-host.context";
import {
  useOpenInsertMenuHandler,
  useWorkflowInsertMenu,
} from "../../contexts/workflow-insert-menu.context";
import type { EdgeInsertData } from "../../types/workflow-path.types";
import { PulseIconButton } from "../PulseIconButton";

export const EdgeWithButton = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  source,
  target,
  data,
}: EdgeProps) => {
  const { translate } = useWorkflowGraphHost();
  const { onOpenInsertMenu, showEdgeInsertControls } = useWorkflowInsertMenu();
  const edgeData = data as EdgeInsertData | undefined;
  const insertPath = edgeData?.insertPath;
  const [path, labelX, labelY] = useMemo(() => {
    return getBezierPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    });
  }, [
    source,
    sourceX,
    sourceY,
    target,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  ]);
  const handleOpenInsertMenu = useOpenInsertMenuHandler(insertPath);
  const showInsert = Boolean(
    showEdgeInsertControls && insertPath && onOpenInsertMenu,
  );

  return (
    <>
      <BaseEdge {...{ path, style, markerEnd }} />
      {showInsert ? (
        <EdgeLabelRenderer>
          <div
            className="button-edge__label nodrag nopan"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            <span className="button-edge__label-content">
              <PulseIconButton
                type="button"
                size={25}
                className="nodrag nopan"
                aria-label={translate("button.add")}
                aria-haspopup="menu"
                onClick={handleOpenInsertMenu}
              >
                <Plus size={14} />
              </PulseIconButton>
            </span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
};
