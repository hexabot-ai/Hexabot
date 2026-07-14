/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { WorkflowValidationActionMetadata } from "@hexabot-ai/agentic";
import { z } from "zod";

import type { IAction } from "@/types/action.types";

const fromCatalogSchema = (schema: IAction["inputSchema"]) =>
  z.fromJSONSchema(schema as unknown as Parameters<typeof z.fromJSONSchema>[0]);

/**
 * Adapt the API's serialized action catalog to the Zod-based validation
 * metadata consumed by the shared agentic workflow validator.
 */
export const createWorkflowValidationActions = (
  actionsByName: ReadonlyMap<string, IAction>,
): Record<string, WorkflowValidationActionMetadata> =>
  Object.fromEntries(
    Array.from(actionsByName.entries()).map(([actionName, action]) => [
      actionName,
      {
        inputSchema: fromCatalogSchema(action.inputSchema),
        settingSchema: fromCatalogSchema(action.settingSchema),
        supportedBindings: action.supportedBindings ?? [],
      },
    ]),
  );
