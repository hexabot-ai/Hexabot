/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Settings } from "@hexabot-ai/agentic";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";

import { getSchemaPropertyNames } from "@/app-components/inputs/JsonSchemaForm";

export const buildSettingsUiSchema = (
  schema?: RJSFSchema,
  formData?: Record<string, unknown>,
): UiSchema | undefined => {
  const properties = getSchemaPropertyNames(schema);

  if (!properties.includes("retries")) {
    return undefined;
  }
  const data = formData?.retries as Settings["retries"] | undefined;

  if (data?.enabled) {
    return undefined;
  }
  const retryProps = getSchemaPropertyNames(
    schema?.properties?.["retries"] as RJSFSchema,
  );

  return {
    retries: retryProps
      .filter((p) => p !== "enabled")
      .reduce((acc, p) => {
        return {
          ...acc,
          [p]: { "ui:disabled": true },
        };
      }, {}),
  };
};
