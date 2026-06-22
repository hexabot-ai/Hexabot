# Agent Handbook — @hexabot-ai/agentic

Use this file as the predictable entrypoint for AI coding agents working on the `@hexabot-ai/agentic` package. The package is a typed workflow DSL plus a resumable runner for orchestrating multi-step AI/automation flows with JSONata expressions.

## Repository orientation
- Package root: `packages/agentic`.
- Product overview: `packages/agentic/README.md`.
- DSL reference: `packages/agentic/DSL.md` (annotated YAML language guide).
- Runtime source: `packages/agentic/src/*`.
- Example workflow + actions: `packages/agentic/examples/full/workflow.yml|ts` and `packages/agentic/examples/full/actions/*`.
- Tests: `packages/agentic/src/__tests__` (Jest).

## Tooling and commands
- Node.js >= 24.17.0; PNPM workspace (run commands from repo root).
- Build: `pnpm --filter @hexabot-ai/agentic build`
- Type-check: `pnpm --filter @hexabot-ai/agentic typecheck`
- Tests: `pnpm --filter @hexabot-ai/agentic test`
- Run the full sample workflow: `pnpm dlx ts-node packages/agentic/examples/full/workflow.ts`
- Run the suspend/resume quickstart: `pnpm dlx ts-node packages/agentic/examples/suspend-resume/workflow.ts`

## DSL essentials (YAML or JS object)
- Workflow parts: optional `inputs.schema`, `context`, `defaults.settings`, required `defs`, `flow`, `outputs`. Long-term state should be stored on the workflow context.
- Expressions: any string starting with `=` is JSONata; everything else is literal. Scopes: `$input`, `$context`, `$output`, `$iteration` (`item`, `index`), `$accumulator`.
- Flow primitives: `do` (single task def reference), `parallel` (`strategy: wait_all|wait_any`), `conditional` (first truthy branch wins; optional `else`), `loop` with required `type` discriminator (`for_each` or `while`), optional `accumulate`, and `max_concurrency` hint on `for_each` loops.
- Defs: `defs.<name>` is the only root registry. `kind: task` defs execute actions (`action`, optional `inputs`/`settings`/`bindings`), non-task defs require `settings` and may also declare nested `bindings`.
- Bindings: any def may declare `bindings`; validation is recursive and enforces cardinality, kind matching, duplicates, cycles, and allowlists from `action.supportedBindings` or `kind.supportedBindings`.
- Outputs: required map evaluated after the flow; values are expressions that usually reference `$output.<task>.*`.

## Runtime architecture (TS)
- Entry points: `Workflow.fromYaml` / `Workflow.fromDefinition` validate via `validateWorkflow` then compile via `compileWorkflow` into a `CompiledWorkflow`.
- Runner: `WorkflowRunner.start` executes the compiled flow; `resume` continues after a suspension. `Workflow.run` is a convenience that throws an error carrying suspension details (`stepId`, `reason`, `data`) on suspension.
- Step ids: generated from the flow path (e.g., `0.branch.1:conditional`); loop iterations append `[i.j]` suffixes.
- Snapshots: every start/resume returns `{ status, snapshot }` with `WorkflowSnapshot.actions` capturing per-step status (`pending|running|suspended|completed|failed|cancelled|skipped`).
- Events: runners can emit to any `emit`/`on`-compatible emitter (`WorkflowEventEmitter` is the built-in helper) with `hook:workflow:start|finish|failure|suspended` and `hook:step:start|success|error|cancelled|suspended|skipped`.
- Evaluation order: task-def inputs are evaluated before marking a step as running; task results are stored raw under `$output.<task>`. Final workflow outputs are evaluated only after the flow completes.
- Parallel semantics: child steps start concurrently. Each branch receives an isolated `$output`, `$iteration`, `$accumulator`, and context state snapshot from parallel entry; parent `$output` is merged only when the block resolves. `wait_all` merges branch output deltas in child-index order. `wait_any` uses the first successful branch, aborts siblings with `AbortSignal`, and discards loser outputs. Suspensions inside parallel fail the workflow with `ParallelSuspensionError`.
- Loop semantics:
  - `type: for_each`: iterates over evaluated `for_each.in` (arrays only), threads `$iteration` and accumulator, and optionally checks `until` after each iteration.
  - `type: while`: evaluates `while` before each iteration and then executes loop steps.
  - Accumulated values are exposed under `$output.<loop_name>.<accumulator_alias>` when `name` is set.

## Actions and settings
- Create actions with `defineAction` (or extend `AbstractAction`): provide `name` (snake_case), optional `description`, `inputSchema`, `outputSchema`, optional `settingSchema`, and an async `execute`. `execute` receives an `AbortSignal` as `signal`; long-running actions should stop promptly when it is aborted.
- `AbstractAction.run` handles `parseInput`, merges/parses settings (defaults live in `SettingsSchema`, including `timeout_ms` and retry policy), wraps `execute` with timeout/retries, and validates the output.
- Suspension: inside `execute`, `await context.workflow.suspend(options)`; the runner marks the step as `suspended` and returns `{ status: 'suspended', step, reason?, data? }`. On resume, the suspended action continues from the `await` with the provided data.
- Settings merge: `mergeSettings` deep-merges `defaults.settings` with task-def overrides; undefined values do not clobber defaults.

## Conventions and gotchas
- Expressions must start with `=`; validation will parse JSONata and fail early on syntax errors.
- Task/action names are enforced as `snake_case` by `assertSnakeCaseName`.
- Non-task defs must include `settings` (empty object is valid).
- If compile-time `actions` are provided, any def declaring `action` must resolve to a known action.
- `max_concurrency` is available only on `loop.type: for_each`, and is not yet enforced by the in-process runner (treat it as metadata/hint for now).
- Legacy loop blocks without `loop.type` are invalid and must be migrated.
- `timeout_ms: 0` disables timeouts. Default retries come from `DEFAULT_RETRY_SETTINGS` (3 attempts, exponential backoff starting at 25ms, capped at 10s, no jitter).
- Task-level output mapping is not supported; the entire raw action result is always stored under `$output.<task>`.
- `BaseWorkflowContext.workflow` is attached only while running; don’t hold references beyond execution.
- `context.workflow.suspend()` is valid only outside parallel blocks; inside parallel branches it rejects with `ParallelSuspensionError`.

## When extending the package
- Add or adjust DSL shape in `packages/agentic/src/dsl.types.ts` and update `packages/agentic/DSL.md` plus the example workflow if behavior changes.
- Extend runtime behavior in `packages/agentic/src/workflow-*.ts`; keep tests in `packages/agentic/src/__tests__` in sync.
- For new actions in the example, update `packages/agentic/examples/full/actions/*` and `packages/agentic/examples/full/workflow.yml` so the runnable demo continues to work.
- Prefer small, well-named helper functions; keep the public surface re-exported via `packages/agentic/src/index.ts`.

## Quick reference: examples
- Annotated YAML DSL: `packages/agentic/examples/full/workflow.yml` shows a realistic flow with human-in-the-loop pauses, branching, and a loop accumulator.
- Runnable script: `packages/agentic/examples/full/workflow.ts` builds a workflow from YAML, registers actions, attaches an event emitter, and demonstrates `WorkflowRunner.start`.
- While-loop demo: `packages/agentic/examples/loop/workflow.yml|ts` shows a `loop.type: while` validation loop with suspend/resume replies.
- Suspend/resume minimal demo: `packages/agentic/examples/suspend-resume/workflow.yml|ts` shows pausing a run until `resume` is called with a reply payload.
