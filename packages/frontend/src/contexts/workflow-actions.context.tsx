/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { PropsWithChildren, createContext, useContext, useMemo } from "react";

import { useApiClientQuery } from "@/hooks/useApiClient";
import type { IAction } from "@/types/action.types";

type WorkflowActionsCatalogContextValue = {
  actions: IAction[];
  actionsByName: Map<string, IAction>;
  isLoading: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isError: boolean;
};

const WorkflowActionsCatalogContext =
  createContext<WorkflowActionsCatalogContextValue | null>(null);

type WorkflowActionsProviderProps = PropsWithChildren<{
  workflowType?: string;
}>;

export const WorkflowActionsProvider = ({
  children,
  workflowType,
}: WorkflowActionsProviderProps) => {
  const {
    data: actions = [],
    isLoading,
    isFetching,
    isSuccess,
    isError,
  } = useApiClientQuery("getActions", {
    params: workflowType ? [workflowType] : undefined,
    enabled: !!workflowType,
    select: (actions) =>
      actions.map((action) => ({
        ...action,
        title: action.name
          .replace(/_/g, " ")
          .replace(/\b\w/g, (char: string) => char.toUpperCase()),
        parseSettings: (payload) => payload,
      })),
  });
  const actionsByName = useMemo(
    () =>
      new Map<string, IAction>(actions.map((action) => [action.name, action])),
    [actions],
  );
  const value = useMemo(
    () => ({
      actions,
      actionsByName,
      isLoading,
      isFetching,
      isSuccess,
      isError,
    }),
    [actions, actionsByName, isLoading, isFetching, isSuccess, isError],
  );

  return (
    <WorkflowActionsCatalogContext.Provider value={value}>
      {children}
    </WorkflowActionsCatalogContext.Provider>
  );
};

export const useWorkflowActionsCatalog = () => {
  const context = useContext(WorkflowActionsCatalogContext);

  if (!context) {
    throw new Error(
      "useWorkflowActionsCatalog must be used within a WorkflowActionsProvider",
    );
  }

  return context;
};
