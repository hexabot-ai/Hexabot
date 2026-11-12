/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { EdgeTypes, NodeTypes } from "@xyflow/react";
import { memo } from "react";

import { EEdgeType, ENodeType } from "../types/workflow-node.types";

import { EdgeWithButton } from "./edges/EdgeWithButton";
import { Binding } from "./workflow-nodes/Binding";
import { BindingPlaceholder } from "./workflow-nodes/BindingPlaceholder";
import { BranchPlaceholder } from "./workflow-nodes/BranchPlaceholder";
import { Group } from "./workflow-nodes/Group";
import { Indicator } from "./workflow-nodes/Indicator";
import { Operator } from "./workflow-nodes/Operator";
import { Task } from "./workflow-nodes/Task";

export const NODE_TYPES = {
  [ENodeType.BINDING_SINGLE]: memo(Binding),
  [ENodeType.BINDING_MULTI]: memo(Binding),
  [ENodeType.INDICATOR]: memo(Indicator),
  [ENodeType.OPERATOR]: memo(Operator),
  [ENodeType.TASK]: memo(Task),
  [ENodeType.GROUP]: memo(Group),
  [ENodeType.BRANCH_PLACEHOLDER]: memo(BranchPlaceholder),
  [ENodeType.BINDING_PLACEHOLDER]: memo(BindingPlaceholder),
} satisfies NodeTypes;

export const EDGE_TYPES = {
  [EEdgeType.EDGE_WITH_BUTTON]: memo(EdgeWithButton),
} satisfies EdgeTypes;
