/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { type BindingKindSchemas } from "@hexabot-ai/agentic";
import type { JSONSchema } from "monaco-yaml";
import { PropsWithChildren, createContext, useContext, useMemo } from "react";
import { z } from "zod";

import { useApiClientQuery } from "@/hooks/useApiClient";

export type WorkflowBindingDefinition = {
  schema: JSONSchema;
  multiple: boolean;
  color?: string;
  icon?: string;
  supportedBindings?: string[];
  actionPolicy?: "forbidden" | "optional" | "required";
};

export type WorkflowBindingsCatalog = Record<string, WorkflowBindingDefinition>;
type WorkflowBindingsCatalogContextValue = {
  bindings: WorkflowBindingsCatalog;
  bindingsByName: Map<string, WorkflowBindingDefinition>;
  bindingKinds: BindingKindSchemas;
  isLoading: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isError: boolean;
};

const WorkflowBindingsCatalogContext =
  createContext<WorkflowBindingsCatalogContextValue | null>(null);

export const WorkflowBindingsProvider = ({ children }: PropsWithChildren) => {
  const {
    data: bindings = {},
    isLoading,
    isFetching,
    isSuccess,
    isError,
  } = useApiClientQuery("getWorkflowBindings");
  const bindingsByName = useMemo(
    () =>
      new Map<string, WorkflowBindingDefinition>(
        Object.entries(bindings).map(([name, bindingDefinition]) => [
          name,
          bindingDefinition,
        ]),
      ),
    [bindings],
  );
  const bindingKinds = useMemo<BindingKindSchemas>(
    () =>
      Object.fromEntries(
        Object.entries(bindings).map(([kind, bindingDefinition]) => [
          kind,
          {
            schema: z.fromJSONSchema(
              bindingDefinition.schema as unknown as Parameters<
                typeof z.fromJSONSchema
              >[0],
            ),
            multiple: bindingDefinition.multiple ?? true,
            supportedBindings: bindingDefinition.supportedBindings ?? [],
            actionPolicy: bindingDefinition.actionPolicy ?? "optional",
          },
        ]),
      ),
    [bindings],
  );

  return (
    <WorkflowBindingsCatalogContext.Provider
      value={{
        bindings,
        bindingsByName,
        bindingKinds,
        isLoading,
        isFetching,
        isSuccess,
        isError,
      }}
    >
      {children}
    </WorkflowBindingsCatalogContext.Provider>
  );
};

export const useWorkflowBindingsCatalog = () => {
  const context = useContext(WorkflowBindingsCatalogContext);

  if (!context) {
    throw new Error(
      "useWorkflowBindingsCatalog must be used within a WorkflowBindingsProvider",
    );
  }

  return context;
};
