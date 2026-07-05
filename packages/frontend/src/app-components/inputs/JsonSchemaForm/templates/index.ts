/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ActionArrayFieldItemTemplate } from "./ActionArrayFieldItemTemplate";
import { ActionArrayFieldTemplate } from "./ActionArrayFieldTemplate";
import { ActionBaseInputTemplate } from "./ActionBaseInputTemplate";
import { ActionFieldTemplate } from "./ActionFieldTemplate";
import { ActionMultiSchemaFieldTemplate } from "./ActionMultiSchemaFieldTemplate";
import { ActionObjectFieldTemplate } from "./ActionObjectFieldTemplate";
import { ActionWrapIfAdditionalTemplate } from "./ActionWrapIfAdditionalTemplate";
import { EmptyDescriptionFieldTemplate } from "./EmptyDescriptionFieldTemplate";
import { NestedTitleField } from "./NestedTitleField";

export const FORM_TEMPLATES = {
  TitleFieldTemplate: NestedTitleField,
  FieldTemplate: ActionFieldTemplate,
  DescriptionFieldTemplate: EmptyDescriptionFieldTemplate,
  BaseInputTemplate: ActionBaseInputTemplate,
  ObjectFieldTemplate: ActionObjectFieldTemplate,
  ArrayFieldTemplate: ActionArrayFieldTemplate,
  ArrayFieldItemTemplate: ActionArrayFieldItemTemplate,
  MultiSchemaFieldTemplate: ActionMultiSchemaFieldTemplate,
  WrapIfAdditionalTemplate: ActionWrapIfAdditionalTemplate,
};
