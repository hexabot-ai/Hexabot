/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Templates } from "@rjsf/mui";

import { withTooltipLabel } from "../widgets/shared";

import { ActionArrayFieldItemTemplate } from "./ActionArrayFieldItemTemplate";
import { ActionArrayFieldTemplate } from "./ActionArrayFieldTemplate";
import { ActionFieldTemplate } from "./ActionFieldTemplate";
import { ActionMultiSchemaFieldTemplate } from "./ActionMultiSchemaFieldTemplate";
import { ActionObjectFieldTemplate } from "./ActionObjectFieldTemplate";
import { ActionWrapIfAdditionalTemplate } from "./ActionWrapIfAdditionalTemplate";
import { NestedTitleField } from "./NestedTitleField";

export const FORM_TEMPLATES = {
  TitleFieldTemplate: NestedTitleField,
  FieldTemplate: ActionFieldTemplate,
  // Descriptions render as label tooltips instead
  DescriptionFieldTemplate: () => null,
  BaseInputTemplate: withTooltipLabel(Templates.BaseInputTemplate!, {
    mergeInputLabelSx: true,
  }),
  ObjectFieldTemplate: ActionObjectFieldTemplate,
  ArrayFieldTemplate: ActionArrayFieldTemplate,
  ArrayFieldItemTemplate: ActionArrayFieldItemTemplate,
  MultiSchemaFieldTemplate: ActionMultiSchemaFieldTemplate,
  WrapIfAdditionalTemplate: ActionWrapIfAdditionalTemplate,
};
