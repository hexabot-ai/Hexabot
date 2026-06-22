# Agent Handbook - @hexabot-ai/graph

Use this file as the entrypoint for AI coding agents working on the Hexabot workflow graph package. It summarizes the xyflow runtime, graph build pipeline, and package-specific conventions so changes remain consistent and safe.

## Repository orientation
- Package root: `packages/graph`.
- Package docs: `packages/graph/README.md`.
- Public entry export: `packages/graph/src/index.ts`.
- Workflow public surface: `packages/graph/src/workflow/index.ts`.
- Main graph component: `packages/graph/src/workflow/components/WorkflowGraph.tsx`.
- Runtime hooks: `packages/graph/src/workflow/hooks/*`.
- Graph builder pipeline: `packages/graph/src/workflow/utils/graph-builder/*`.
- Layout and projection utilities: `packages/graph/src/workflow/utils/workflow-node.utils.ts`.
- Shared graph types: `packages/graph/src/workflow/types/workflow-node.types.ts`.
- Constants and menu definitions: `packages/graph/src/workflow/constants/workflow.constants.ts`.
- Stylesheet export source: `packages/graph/src/workflow/styles/index.css`.
- Tests: `packages/graph/src/**/*.test.ts` and `packages/graph/src/**/*.test.tsx`.

## Tooling and commands
- Node.js requirement: `^24.17.0`.
- Run commands from repo root with PNPM workspace filters.
- Dev watch build: `pnpm --filter @hexabot-ai/graph run dev`.
- Build: `pnpm --filter @hexabot-ai/graph run build`.
- Typecheck: `pnpm --filter @hexabot-ai/graph run typecheck`.
- Lint: `pnpm --filter @hexabot-ai/graph run lint`.
- Lint (fix): `pnpm --filter @hexabot-ai/graph run lint:fix`.
- Tests: `pnpm --filter @hexabot-ai/graph run test`.
- Tests (watch): `pnpm --filter @hexabot-ai/graph run test:watch`.
- Clean artifacts: `pnpm --filter @hexabot-ai/graph run clean`.

## Public APIs and contracts
- This package is documentation-only in this guide; do not change runtime contracts unless explicitly requested.
- Core public component and prop contracts are defined in `packages/graph/src/workflow/components/WorkflowGraph.tsx`.
- Public exports are defined by `packages/graph/src/workflow/index.ts` and re-exported from `packages/graph/src/index.ts`.
- Shared node/edge enums and graph types are in `packages/graph/src/workflow/types/workflow-node.types.ts`.

## Runtime architecture
The graph render pipeline follows this sequence:

1. Traverse compiled flow into semantic nodes/edges in `packages/graph/src/workflow/utils/graph-builder/traverse.ts`.
2. Decorate semantic edges for group overlays and direct-edge visibility rules in `packages/graph/src/workflow/utils/graph-builder/decorate.ts`.
3. Project semantic graph to xyflow node/edge shapes in `packages/graph/src/workflow/utils/graph-builder/project.ts`.
4. Layout nodes with ELK, then place attachment nodes and group overlays in `packages/graph/src/workflow/utils/workflow-node.utils.ts`.
5. Orchestrate async layout and empty-graph fallback in `packages/graph/src/workflow/hooks/useWorkflowGraphLayout.ts`.
6. Render and bind runtime behavior in `packages/graph/src/workflow/components/WorkflowGraph.tsx`.

Related runtime hooks:
- Selection controller: `packages/graph/src/workflow/hooks/useWorkflowSelectionController.ts`.
- Viewport sync and first-insert centering: `packages/graph/src/workflow/hooks/useWorkflowViewport.ts`.
- Focus and fit-view animation: `packages/graph/src/workflow/hooks/useFocusNode.ts`.
- Insert menu bindings for edge and placeholder insertion points: `packages/graph/src/workflow/hooks/useInsertMenuBindings.ts`.

## xyflow integration contracts
- `WorkflowGraph` internally wraps the canvas with `ReactFlowProvider`; consumers should not add an extra provider around it.
- Selection is controlled: callers provide `selection.selectedNodeIds`; updates are emitted via `selection.onChange`.
- Viewport is controlled: callers pass `viewport.value`; panning/zoom updates are emitted through `viewport.onChange`.
- Insert behavior is optional: when `insertion.onInsertAtPath` exists, insert callbacks are wired onto eligible edges/placeholders.
- Empty workflows can render root insertion UI when `insertion.onInsertAtRoot` is provided.
- Imperative ref API (`WorkflowGraphHandle`) currently exposes:
  - `animateFocus(nodeIds?)`
  - `requestCenterAfterFirstInsert()`
  - `clearCenterAfterFirstInsert()`

## Conventions and gotchas
- Preserve required license headers in TS/TSX files; ESLint enforces this through `header/header`.
- Path alias `@/*` maps to `packages/graph/src/*` (`tsconfig.json`).
- `no-console` is enforced; keep logging out of production paths. Current layout error logging in `useWorkflowGraphLayout.ts` is an explicit lint-disabled exception.
- Keep `resolveWorkflowPortRule` (`port-rules.ts`) and `getHandleConfig` (`handle.utils.ts`) aligned; update corresponding tests when changing handle behavior.
- Group overlay edges are derived from semantic edges in `decorate.ts`; attachment source handles (`AGENT_MODEL`, `AGENT_MEMORY`, `AGENT_TOOL`) intentionally bypass overlay grouping logic.
- Preserve CSS export compatibility in `package.json`:
  - `"./workflow.css": "./src/workflow/styles/index.css"`

## Testing workflows
- Test runner: Vitest (`jsdom`) configured in `packages/graph/vitest.config.mts`.
- Package tests command: `pnpm --filter @hexabot-ai/graph run test`.
- High-value suites:
  - `packages/graph/src/workflow/utils/workflow-node.utils.test.ts` (graph-building and branch/group wiring behavior).
  - `packages/graph/src/workflow/utils/workflow-selection.utils.test.ts` (selection snapshot stability and equality checks).
  - `packages/graph/src/workflow/utils/handle.utils.test.ts` (port/handle rule parity and conditional/attachment handle metadata).
  - `packages/graph/src/index.test.ts` (public export sanity).
- Recommended local gate before merge:
  - `pnpm --filter @hexabot-ai/graph run typecheck`
  - `pnpm --filter @hexabot-ai/graph run lint`
  - `pnpm --filter @hexabot-ai/graph run test`
  - `pnpm --filter @hexabot-ai/graph run build`

## Common change recipes
1. Add or change a node/edge type:
   - Update enums, node/edge registries, and related data types in `workflow-node.types.ts`.
   - Register defaults in `workflow.constants.ts`.
   - Add or update rendering component(s) under `components/workflow-nodes` or `components/edges`.
   - Validate graph-builder output and add tests in `workflow-node.utils.test.ts`.
2. Change layout or spacing behavior:
   - Update ELK options, group padding/alpha, and attachment offsets in `workflow-node.utils.ts`.
   - If handle position semantics change, update `port-rules.ts` and `handle.utils.ts` together.
   - Validate both horizontal and vertical direction flows.
3. Adjust insertion menu or branch-placeholder behavior:
   - Update insert menu items in `workflow.constants.ts`.
   - Update insertion wiring in `useInsertMenuBindings.ts`.
   - Confirm edge `insertPath` propagation in graph-builder output and UI behavior.
4. Update execution-state visuals:
   - Modify `getWorkflowStateConfig` and `resolveWorkflowStepTheme` in `workflow-theme.utils.ts`.
   - Verify icon/color behavior for running, suspended, failed, and completed states.

## Guardrails for agents
- Keep package scope tight. Avoid unrelated edits outside `packages/graph` unless explicitly requested.
- Do not edit generated artifacts or transient outputs:
  - `packages/graph/dist/**`
  - `packages/graph/coverage/**`
  - `packages/graph/*.tsbuildinfo`
- Keep public exports stable unless the task explicitly requires API changes.
- Preserve compatibility with `@hexabot-ai/agentic` compiled-flow semantics used by traversal and projection.
- When changing graph semantics, update tests in the same change.
