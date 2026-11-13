/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { MemoryDefinition } from "@hexabot-ai/types";
import type { PropsWithChildren } from "react";
import { useMemo } from "react";

import { JsonataGlobalsSchemaProvider } from "@/app-components/inputs/JsonataFormulaField";
import { useWorkflowActionsCatalog } from "@/contexts/workflow-actions.context";
import { useGetFromCache } from "@/hooks/crud/useGet";
import { EntityType } from "@/services/types";

import { useWorkflow } from "../hooks/useWorkflow";
import {
  buildJsonataGlobalsSchema,
  extractMemoryDefinitionIdsFromWorkflowDefinition,
} from "../utils/jsonata-globals-schema.utils";

export const WorkflowJsonataGlobalsSchemaProvider = ({
  children,
}: PropsWithChildren) => {
  const { definition, inputSchema, taskDefinitions } = useWorkflow();
  const { actionsByName } = useWorkflowActionsCatalog();
  const getMemoryDefinitionFromCache = useGetFromCache(
    EntityType.MEMORY_DEFINITION,
  );
  const memoryDefinitionIds = useMemo(
    () => extractMemoryDefinitionIdsFromWorkflowDefinition(definition),
    [definition],
  );
  const memoryDefinitions = useMemo(
    () =>
      memoryDefinitionIds
        .map((memoryDefinitionId) =>
          getMemoryDefinitionFromCache(memoryDefinitionId),
        )
        .filter((memoryDefinition): memoryDefinition is MemoryDefinition =>
          Boolean(memoryDefinition),
        ),
    [getMemoryDefinitionFromCache, memoryDefinitionIds],
  );
  const globalsSchema = useMemo(
    () =>
      buildJsonataGlobalsSchema({
        definition,
        taskDefinitions,
        actionsByName,
        memoryDefinitions,
        inputSchema,
      }),
    [
      actionsByName,
      definition,
      inputSchema,
      memoryDefinitions,
      taskDefinitions,
    ],
  );

  return (
    <JsonataGlobalsSchemaProvider globalsSchema={globalsSchema}>
      {children}
    </JsonataGlobalsSchemaProvider>
  );
};
