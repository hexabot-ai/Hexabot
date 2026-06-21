/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowType } from "@hexabot-ai/types";
import type { Workflow } from "@hexabot-ai/types";
import type { LucideIcon } from "lucide-react";

import type { TTranslationKeys } from "@/i18n/i18n.types";

export type FlowsDrawerProps = {
  onNew?: () => void;
  onEdit?: (workflow: Workflow) => void;
  activeCodeDef?: string;
  onActiveDefChange?: () => void;
};

export type FlowTypeKey = WorkflowType | string;

export type FlowTypeInfo = {
  key: FlowTypeKey;
  labelKey: TTranslationKeys;
  icon: LucideIcon;
  color: string;
};

export type FlowTypeMeta = {
  secondaryText?: string;
  badge?: string;
};

export type FlowMatch = {
  workflow: Workflow;
  nameMatch: number[];
  descriptionMatch: number[];
  typeInfo: FlowTypeInfo;
  typeMeta: FlowTypeMeta;
  statusLabel: string;
  isDraft: boolean;
  isSelected: boolean;
  hasUnsaved: boolean;
  errorCount: number;
  errorLabel?: string;
};

export type FlowTypeGroup = {
  info: FlowTypeInfo;
  label: string;
  items: FlowMatch[];
};
