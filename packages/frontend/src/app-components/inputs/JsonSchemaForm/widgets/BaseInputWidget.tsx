/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { getTemplate, type WidgetProps } from "@rjsf/utils";

import { createReadOnlyInputProps } from "../../readOnlyInput.util";

import { toInputString } from "./shared";

/**
 * Builds a text-like widget on top of the registered BaseInputTemplate, so
 * every input keeps ids, blur/focus tracking, error state and the tooltip
 * label. Inputs are rendered read-only until focused to defeat aggressive
 * browser autofill, unless an explicit autoComplete is requested.
 */
const createBaseInputWidget = (type?: string) => {
  const BaseInputWidget = (props: WidgetProps) => {
    const { autoComplete, onChange, options, registry, slotProps, value } =
      props;
    const BaseInputTemplate = getTemplate<"BaseInputTemplate">(
      "BaseInputTemplate",
      registry,
      options,
    );

    return (
      <BaseInputTemplate
        {...props}
        type={type}
        value={toInputString(value)}
        onChange={(nextValue) => onChange(nextValue ?? "")}
        slotProps={{
          ...slotProps,
          htmlInput: autoComplete
            ? slotProps?.htmlInput
            : createReadOnlyInputProps(slotProps?.htmlInput),
        }}
      />
    );
  };

  BaseInputWidget.displayName = `BaseInputWidget(${type ?? "text"})`;

  return BaseInputWidget;
};

export const TextWidget = createBaseInputWidget();
export const EmailWidget = createBaseInputWidget("email");
export const PasswordWidget = createBaseInputWidget("password");
