/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Handle, Position } from "@xyflow/react";
import type { CSSProperties } from "react";

import { useWorkflowGraphHost } from "../../contexts/workflow-graph-host.context";
import type { ENodeType, Port } from "../../types/workflow-node.types";
import { getHandleConfig } from "../../utils/handle.utils";

const PORT_LABEL_OFFSET = "calc(100% + 4px)";
const BASE_PORT_LABEL_STYLE: CSSProperties = {
  position: "absolute",
};
const HORIZONTAL_PORT_LABEL_STYLE: CSSProperties = {
  ...BASE_PORT_LABEL_STYLE,
  top: "50%",
  transform: "translateY(-50%)",
};
const VERTICAL_PORT_LABEL_STYLE: CSSProperties = {
  ...BASE_PORT_LABEL_STYLE,
  left: "50%",
  transform: "translateX(-50%)",
};
const PORT_LABEL_STYLE_BY_POSITION: Record<Position, CSSProperties> = {
  [Position.Left]: {
    ...HORIZONTAL_PORT_LABEL_STYLE,
    right: PORT_LABEL_OFFSET,
  },
  [Position.Right]: {
    ...HORIZONTAL_PORT_LABEL_STYLE,
    left: PORT_LABEL_OFFSET,
  },
  [Position.Top]: {
    ...VERTICAL_PORT_LABEL_STYLE,
    bottom: PORT_LABEL_OFFSET,
  },
  [Position.Bottom]: {
    ...VERTICAL_PORT_LABEL_STYLE,
    top: PORT_LABEL_OFFSET,
  },
};
const getPortLabelStyle = (position: Position): CSSProperties => {
  return PORT_LABEL_STYLE_BY_POSITION[position];
};

export const GenericHandle = <T extends ENodeType>({
  id,
  label,
  hidden = false,
  style: styleOverride,
}: {
  id: Port<T>;
  label?: string;
  hidden?: boolean;
  style?: CSSProperties;
}) => {
  const { direction, translate } = useWorkflowGraphHost();
  const config = getHandleConfig(id, direction);

  return (
    <Handle
      {...config}
      id={id}
      isConnectable={false}
      isValidConnection={() => false}
      style={{
        ...config.style,
        ...styleOverride,
        ...(hidden
          ? {
              opacity: 0,
              pointerEvents: "none",
            }
          : {}),
      }}
    >
      {label ? (
        <span
          className="workflow-operator-port-label nodrag nopan"
          style={getPortLabelStyle(config.position)}
        >
          {translate(label, { defaultValue: label }) || label}
        </span>
      ) : null}
    </Handle>
  );
};
