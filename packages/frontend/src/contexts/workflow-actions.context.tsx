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

// The catalog must keep its identity across renders: the workflow definition
// is recompiled and the graph laid out again whenever it changes. So `select`
// and what it puts on each action are module-level references — an inline
// `select` runs on every render, and a per-action closure defeats the query's
// structural sharing.
const EMPTY_ACTIONS: IAction[] = [];
const parseSettings = (payload: unknown) => payload;
const toCatalogActions = (actions: IAction[]) =>
  actions.map((action) => ({
    ...action,
    title: action.name
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char: string) => char.toUpperCase()),
    parseSettings,
  }));

export const WorkflowActionsProvider = ({
  children,
  workflowType,
}: WorkflowActionsProviderProps) => {
  const {
    data: actions = EMPTY_ACTIONS,
    isLoading,
    isFetching,
    isSuccess,
    isError,
  } = useApiClientQuery("getActions", {
    params: workflowType ? [workflowType] : undefined,
    enabled: !!workflowType,
    select: toCatalogActions,
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
