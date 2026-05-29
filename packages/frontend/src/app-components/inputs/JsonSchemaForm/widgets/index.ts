/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ActionCheckboxesWidget } from "./ActionCheckboxesWidget";
import { ActionCheckboxWidget } from "./ActionCheckboxWidget";
import { ActionRadioWidget } from "./ActionRadioWidget";
import { ActionRangeWidget } from "./ActionRangeWidget";
import { ActionSelectWidget } from "./ActionSelectWidget";
import { AutoCompleteWidget } from "./AutoCompleteWidget";
import { EmailWidget } from "./EmailWidget";
import { JsonataTextWidget } from "./JsonataTextWidget";
import { PasswordWidget } from "./PasswordWidget";
import { TextWidget } from "./TextWidget";

export const FORM_WIDGETS_BASE = {
  SelectWidget: ActionSelectWidget,
  CheckboxWidget: ActionCheckboxWidget,
  CheckboxesWidget: ActionCheckboxesWidget,
  RadioWidget: ActionRadioWidget,
  RangeWidget: ActionRangeWidget,
  AutoCompleteWidget,
  TextWidget,
  EmailWidget,
  PasswordWidget,
} as const;

export const FORM_WIDGETS = {
  ...FORM_WIDGETS_BASE,
  TextWidget: JsonataTextWidget,
  TextareaWidget: JsonataTextWidget,
  URLWidget: JsonataTextWidget,
  EmailWidget: JsonataTextWidget,
  UpDownWidget: JsonataTextWidget,
} as const;

export const getFormWidgets = (enableJsonataTextWidget = true) =>
  enableJsonataTextWidget ? FORM_WIDGETS : FORM_WIDGETS_BASE;
