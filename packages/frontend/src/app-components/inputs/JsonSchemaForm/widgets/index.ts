/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Widgets } from "@rjsf/mui";

import { ActionCheckboxWidget } from "./ActionCheckboxWidget";
import { AutoCompleteWidget } from "./AutoCompleteWidget";
import { EmailWidget, PasswordWidget, TextWidget } from "./BaseInputWidget";
import { JsonataTextWidget } from "./JsonataTextWidget";
import { withTooltipLabel } from "./shared";

export const FORM_WIDGETS_BASE = {
  SelectWidget: withTooltipLabel(Widgets.SelectWidget, {
    mergeInputLabelSx: true,
  }),
  CheckboxWidget: ActionCheckboxWidget,
  CheckboxesWidget: withTooltipLabel(Widgets.CheckboxesWidget),
  RadioWidget: withTooltipLabel(Widgets.RadioWidget),
  RangeWidget: withTooltipLabel(Widgets.RangeWidget),
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
