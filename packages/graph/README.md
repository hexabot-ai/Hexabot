# @hexabot-ai/graph

Internal React + xyflow package for rendering and interacting with Hexabot workflow graphs.

## Highlights

- `WorkflowGraph` component with built-in controls, insert menus, node selection syncing, and viewport syncing.
- ELK-based automatic layout (`elkjs`) for compiled workflow steps.
- Support for branch/parallel/loop operators, nested group overlays, and generic binding attachments.
- Selection helpers to build stable selection snapshots from xyflow nodes.
- Theme helpers to resolve workflow step visuals from action metadata and runtime execution status.

## Installation & Requirements

`@hexabot-ai/graph` is currently an internal workspace package (`"private": true`).

- Node.js: `^24.17.0`
- Peer dependencies: `react@^18`, `react-dom@^18`, `@xyflow/react@^12.10.0`

If you work inside this monorepo, dependencies are already managed through PNPM workspaces.

## Quick Start

Import the package stylesheet once in your app entrypoint:

```ts
import "@hexabot-ai/graph/workflow.css";
```

Minimal `WorkflowGraph` integration:

```tsx
import type { CompiledStep, WorkflowDefinition } from "@hexabot-ai/agentic";
import {
  WorkflowGraph,
  type EdgeInsertType,
  type FlowStepPath,
  type WorkflowGraphHandle,
  type WorkflowSelectionSnapshot,
} from "@hexabot-ai/graph";
import { useCallback, useMemo, useRef, useState } from "react";

type Props = {
  definition?: WorkflowDefinition;
  compiledFlow?: CompiledStep[];
};

export const WorkflowGraphExample = ({
  definition,
  compiledFlow,
}: Props) => {
  const graphRef = useRef<WorkflowGraphHandle | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [focusNodeIds, setFocusNodeIds] = useState<string[] | undefined>(undefined);
  const [viewport, setViewport] = useState({
    id: "workflow-1",
    x: 0,
    y: 0,
    zoom: 1,
  });

  const actionCatalog = useMemo(
    () =>
      new Map([
        [
          "send_message",
          {
            name: "send_message",
            color: "#0288d1",
          },
        ],
      ]),
    [],
  );

  const handleSelectionChange = useCallback(
    (snapshot: WorkflowSelectionSnapshot) => {
      setSelectedNodeIds(snapshot.nodeIds);
    },
    [],
  );

  const handleInsertAtPath = useCallback(
    (insertType: EdgeInsertType, stepPath: FlowStepPath) => {
      // Open your own "add step" UI and insert at stepPath
      console.log("insert at path", insertType, stepPath);
    },
    [],
  );

  const handleInsertAtRoot = useCallback((insertType: EdgeInsertType) => {
    // Useful for empty workflows
    graphRef.current?.requestCenterAfterFirstInsert();
    console.log("insert at root", insertType);
  }, []);

  return (
    <WorkflowGraph
      ref={graphRef}
      t={(key) => key}
      model={{
        definition,
        compiledFlow,
        actionCatalog,
        executionStates: {},
        layoutDirection: "horizontal",
      }}
      selection={{
        selectedNodeIds,
        focusNodeIds,
        onChange: handleSelectionChange,
        onFocusComplete: () => {
          setFocusNodeIds(undefined);
        },
      }}
      insertion={{
        onInsertAtPath: handleInsertAtPath,
        onInsertAtRoot: handleInsertAtRoot,
      }}
      viewport={{
        value: viewport,
        onChange: ({ x, y, zoom }) => {
          setViewport((current) => ({ ...current, x, y, zoom }));
        },
      }}
      callbacks={{
        onRemoveStep: (stepPath, nodeId) => {
          console.log("remove", stepPath, nodeId);
        },
        onRotate: async (direction) => {
          console.log("rotate to", direction);
          return true;
        },
      }}
    />
  );
};
```

## WorkflowGraph Props Contract

| Prop | Required | Description |
| --- | --- | --- |
| `t` | Yes | Translation function used by built-in labels and aria text. |
| `model` | Yes | Graph data source and rendering context (`definition`, `compiledFlow`, `actionCatalog`, `executionStates`, `layoutDirection`). |
| `selection` | Yes | Controlled selection (`selectedNodeIds`) plus optional focus requests and selection callback. |
| `insertion` | No | Insert handlers for edge insert points and empty-state root insertion. |
| `viewport` | Yes | Controlled viewport input (`value`) and `onChange` callback when pan/zoom changes. |
| `callbacks` | Yes | Interaction callbacks (`onNodeClick`, `onRemoveStep`, `onRotate`). |
| `colorMode` | No | Graph color mode (`"light" | "dark" | "system"`). Defaults to `"system"`. |

Behavior notes:

- `WorkflowGraph` wraps its canvas in an internal `ReactFlowProvider`; you do not need to add one around it.
- Selection is controlled: pass `selectedNodeIds`, and consume `selection.onChange` to keep your source of truth in sync.
- Viewport is controlled through `viewport.value` + `viewport.onChange`.
- `colorMode` controls xyflow light/dark styling; `"system"` tracks `prefers-color-scheme`.
- If `compiledFlow` is empty and `insertion.onInsertAtRoot` is provided, the empty-state insert button is rendered.
- The `WorkflowGraphHandle` ref exposes `animateFocus(nodeIds?)`, `requestCenterAfterFirstInsert()`, and `clearCenterAfterFirstInsert()`.

## Translation Keys Used

Built-in graph UI currently uses these translation keys:

- `button.add`
- `button.delete`
- `message.start`
- `message.stop`
- `message.conditional_indicator`
- `message.loop_indicator`
- `message.parallel_indicator`
- `label.step_trace.type_step`
- `visual_editor.port_label.tools`
- `visual_editor.port_label.model`
- `visual_editor.port_label.memory`

## Public Exports

All exports come from `@hexabot-ai/graph` via `src/index.ts -> src/workflow/index.ts`.

Components:

- `WorkflowGraph`

Hooks and context:

- `useFocusNode`
- `useWorkflowViewport`
- `WorkflowGraphHostContext`
- `useWorkflowGraphHost`
- `WorkflowGraphTranslate`
- `WorkflowGraphHostContextValue`

Core graph types and enums:

- `WorkflowGraphProps`
- `WorkflowGraphColorMode`
- `WorkflowGraphHandle`
- `EdgeInsertType`
- `FlowStepPath`
- `WorkflowSelectionSnapshot`
- `ENodeType`
- `EEdgeType`
- `ELinkType`
- `EIndicatorType`
- `GraphNode`
- `WorkflowGraphData`
- `WorkflowAction`
- `WorkflowExecutionStateMap`
- `INodeConfig`
- `TNodeMetrics`
- `TNodeCardMetrics`
- `TNodeCardContentVariant`

Utilities:

- `getWorkflowDefaultConfig`
- `buildNodesAndEdges`
- `createWorkflowSelectionNode`
- `createWorkflowSelectionSnapshot`
- `isSameWorkflowSelectionNode`
- `isSameWorkflowSelection`
- `resolveWorkflowStepTheme`
- `getWorkflowStateConfig`

## Architecture (Maintainer)

Graph build and render pipeline:

1. Traverse compiled workflow into a semantic registry (`traverseWorkflow` in `src/workflow/utils/graph-builder/traverse.ts`).
2. Decorate semantic edges for group overlays and visibility rules (`decorateSemanticGraph` in `src/workflow/utils/graph-builder/decorate.ts`).
3. Project semantic nodes/edges into xyflow shapes (`projectSemanticGraph` in `src/workflow/utils/graph-builder/project.ts`).
4. Run ELK layered layout and map computed coordinates back to nodes (`layoutNodesWithElk` inside `src/workflow/utils/workflow-node.utils.ts`).
5. Reposition attachment nodes (single-binding and multi-binding) with explicit offsets for readability (`addExtraNodes` in `workflow-node.utils.ts`).
6. Create group overlay nodes from nested operator bounds (`getGroupNodes` in `workflow-node.utils.ts`).

Main customization points:

- `src/workflow/constants/workflow.constants.ts`: default node themes, canonical node metrics (`NODE_METRICS`), derived dimensions (`NODE_DIMENSIONS`), edge styling, operator highlights, insert menu definitions.
- `src/workflow/utils/graph-builder/traverse.ts`: how compiled workflow structures become semantic nodes and edges.
- `src/workflow/utils/port-rules.ts`: handle placement and directional behavior for layout/render parity.
- `src/workflow/styles/*.css`: graph visuals (`xy-theme.css`, `node.css`, `button-edge.css`, `workflow-insert-menu.css`).

Node metrics source of truth:

- `INodeConfig.nodeMetrics` is the preferred source for node sizing and card chrome tokens.
- `INodeConfig.dimensions` remains supported for backward compatibility and is used as a fallback when `nodeMetrics` is missing.
- Layout (ELK + attachment placement) and visual card styling both consume the same metrics model to avoid drift.

Key runtime hooks:

- `useWorkflowGraphLayout`: async layout orchestration + empty graph fallback.
- `useWorkflowSelectionController`: selection diffs and snapshot emission.
- `useWorkflowViewport`: flow-aware viewport initialization and first-insert centering.
- `useInsertMenuBindings`: edge button/open-state handling for contextual insertion.

## Development

Run from repository root:

```bash
pnpm --filter @hexabot-ai/graph run dev
pnpm --filter @hexabot-ai/graph run build
pnpm --filter @hexabot-ai/graph run typecheck
pnpm --filter @hexabot-ai/graph run lint
pnpm --filter @hexabot-ai/graph run test
pnpm --filter @hexabot-ai/graph run clean
```

## Testing Coverage

Current Vitest suites cover:

- Public entrypoint export sanity (`src/index.test.ts`).
- Graph-building behavior in `buildNodesAndEdges` (unique node/edge IDs, conditional/parallel/loop branch wiring, overlay group edges, placeholder/end-edge metadata).
- Selection snapshot helpers (`workflow-selection.utils.test.ts`).
- Handle and port rule consistency (`handle.utils.test.ts`).

## License

Copyright (c) 2026 Hexastack.

This project is licensed under the **Fair Core License, Version 1.0**, with **Apache License 2.0** as the future license (abbrev. **FCL-1.0-ALv2**).

**Change date.** For each version of the software, the Fair Core License converts to Apache-2.0 on the **second anniversary** of the date that version is made available.

**Commercial features & license keys.** Certain features of Hexabot are protected by license-key checks. You **must not** remove, modify, disable, or circumvent those checks, nor enable access to protected functionality without a valid license key.

**Competing uses (non-compete).** Use that competes with Hexastack's business, for example offering Hexabot (or a substantially similar service) as a hosted or commercial product, is not permitted until the conversion to Apache-2.0 for the applicable version.

**Redistribution.** If you distribute copies, modifications, or derivatives, you must include this license and not remove copyright or proprietary notices.

**Patents.** A limited patent license is granted for permitted uses and terminates on patent aggression.

**Trademarks.** "Hexabot" and "Hexastack" are trademarks. Except to identify Hexastack as the origin of the software, no trademark rights are granted.

**Disclaimer.** The software is provided "AS IS," without warranties or conditions of any kind, and Hexastack will not be liable for any damages arising from its use.
