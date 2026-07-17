/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Monaco } from "@monaco-editor/react";
import { configureMonacoYaml, type MonacoYaml } from "monaco-yaml";

import { WORKFLOW_SCHEMA_URI, WORKFLOW_YAML_SCHEMA } from "./schema";

const YAML_SCHEMA_OPTIONS = {
  completion: true,
  enableSchemaRequest: false,
  format: true,
  hover: true,
  validate: true,
  schemas: [
    {
      uri: WORKFLOW_SCHEMA_URI,
      fileMatch: ["*"],
      schema: WORKFLOW_YAML_SCHEMA,
    },
  ],
};

let yamlService: MonacoYaml | null = null;

export const ensureYamlLanguageService = (
  monacoInstance: Monaco,
  schema: typeof WORKFLOW_YAML_SCHEMA,
) => {
  YAML_SCHEMA_OPTIONS.schemas[0].schema = schema;

  if (!yamlService) {
    yamlService = configureMonacoYaml(monacoInstance, YAML_SCHEMA_OPTIONS);

    return;
  }

  void yamlService.update(YAML_SCHEMA_OPTIONS);
};
