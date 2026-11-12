/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IAction } from "@/types/action.types";

import {
  useWorkflowActionsCatalog,
  WorkflowActionsProvider,
} from "./workflow-actions.context";

type QueryOptions = { select?: (actions: IAction[]) => IAction[] };

const query = vi.hoisted(() => ({
  options: [] as QueryOptions[],
  data: undefined as IAction[] | undefined,
}));

vi.mock("@/hooks/useApiClient", () => ({
  useApiClientQuery: (_method: string, options: QueryOptions) => {
    query.options.push(options);

    return {
      data: query.data,
      isLoading: false,
      isFetching: false,
      isSuccess: true,
      isError: false,
    };
  },
}));

type Catalog = ReturnType<typeof useWorkflowActionsCatalog>;

const Probe = ({ onCatalog }: { onCatalog: (catalog: Catalog) => void }) => {
  onCatalog(useWorkflowActionsCatalog());

  return null;
};
const renderCatalog = (): Catalog => {
  const onCatalog = vi.fn<(catalog: Catalog) => void>();

  renderToStaticMarkup(
    <WorkflowActionsProvider workflowType="conversational">
      <Probe onCatalog={onCatalog} />
    </WorkflowActionsProvider>,
  );

  const [catalog] = onCatalog.mock.calls[0] ?? [];

  if (!catalog) {
    throw new Error("WorkflowActionsProvider did not render");
  }

  return catalog;
};
const functionsOf = (action?: IAction) =>
  Object.values(action ?? {}).filter((value) => typeof value === "function");
const rawActions = [
  { name: "send_text_message" },
  { name: "http_request" },
] as IAction[];

describe("WorkflowActionsProvider", () => {
  beforeEach(() => {
    query.options = [];
    query.data = undefined;
  });

  // The workflow definition is recompiled and the graph laid out again each
  // time the catalog changes identity, so it must only change with the data.
  it("gives the query the same select on every render", () => {
    renderCatalog();
    renderCatalog();

    const [first, second] = query.options;

    expect(first?.select).toBeTypeOf("function");
    expect(second?.select).toBe(first?.select);
  });

  it("selects actions that the query can structurally share", () => {
    renderCatalog();

    const select = query.options[0]?.select;
    const [first] = select?.(rawActions) ?? [];
    const [again] = select?.(rawActions) ?? [];

    expect(first).toMatchObject({
      name: "send_text_message",
      title: "Send Text Message",
    });
    // Same data in, same values out — functions included, which the query
    // compares by reference.
    expect(functionsOf(first)).not.toHaveLength(0);
    expect(functionsOf(again)).toStrictEqual(functionsOf(first));
    expect(again).toStrictEqual(first);
  });

  it("keeps one empty catalog while the actions are loading", () => {
    const first = renderCatalog();
    const second = renderCatalog();

    expect(first.actions).toHaveLength(0);
    expect(second.actions).toBe(first.actions);
  });
});
