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
- Node.js >= 24.22.1; PNPM workspace (run commands from repo root).
- Build: `pnpm --filter @hexabot-ai/agentic build`
- Type-check: `pnpm --filter @hexabot-ai/agentic typecheck`
- Tests: `pnpm --filter @hexabot-ai/agentic test`
- Run the full sample workflow: `pnpm dlx ts-node packages/agentic/examples/full/workflow.ts`
- Run the suspend/resume quickstart: `pnpm dlx ts-node packages/agentic/examples/suspend-resume/workflow.ts`

## DSL essentials (YAML or JS object)
- Workflow parts: optional `inputs.schema`, `context`, `defaults.settings`, required `defs`, `flow`, `outputs`. Long-term state should be stored on the workflow context.
- `inputs.schema` is a JSON Schema whose root `type` is `object` (fields under `properties`, `required`, `default`, ...), not a map of fields. `buildWorkflowInputParser` (`src/workflow-compiler.ts`) is the only conversion of it to a parser; `WorkflowRunner.start` refuses a payload that does not match with `WorkflowInputRejectedError` before changing any state.
- Expressions: any string starting with `=` is JSONata; everything else is literal. Scopes: `$input`, `$context`, `$output`, `$iteration` (`item`, `index`), `$accumulator`.
- Flow primitives: `do` (single task def reference), `parallel` (`strategy: wait_all|wait_any`), `conditional` (first truthy branch wins; optional `else`), `loop` with required `type` discriminator (`for_each` or `while`), optional `accumulate`, and `max_concurrency` hint on `for_each` loops.
- Defs: `defs.<name>` is the only root registry. `kind: task` defs execute actions (`action`, optional `inputs`/`settings`/`bindings`), non-task defs require `settings` and may also declare nested `bindings`.
- Bindings: any def may declare `bindings`; validation is recursive and enforces cardinality, kind matching, duplicates, cycles, and allowlists from `action.supportedBindings` or `kind.supportedBindings`.
- Outputs: required map evaluated after the flow; values are expressions that usually reference `$output.<task>.*`.

## Runtime architecture (TS)
- Entry points: `Workflow.fromYaml` / `Workflow.fromDefinition` validate via `validateWorkflow` then compile via `compileWorkflow` into a `CompiledWorkflow`.
- Runner: `WorkflowRunner.start` executes the compiled flow; `resume({ waitId?, resumeData })` resolves one open wait and continues. A suspended result carries `waits` and a JSON `checkpoint`; `WorkflowRunner.fromCheckpoint` / `Workflow.buildRunnerFromCheckpoint` restore a runner from it in any process, and `validateCheckpoint` checks restorability up front with typed errors. `Workflow.run` is a convenience that throws an error carrying `waits` on suspension.
- Step ids: generated from the flow path (e.g., `0.branch.1:conditional`); loop iterations append `[i.j]` suffixes.
- Snapshots: every start/resume returns `{ status, snapshot }` with `WorkflowSnapshot.actions` capturing per-step status (`pending|running|suspended|completed|failed|cancelled|skipped`).
- Events: runners can emit to any `emit`/`on`-compatible emitter (`WorkflowEventEmitter` is the built-in helper) with `hook:workflow:start|finish|failure|suspended|resume_rejected` and `hook:step:start|resumed|resume_rejected|success|error|cancelled|suspended|skipped`. Events about a wait carry `wait: WaitInfo` (on `cancelled` only when a parked wait is dropped); `hook:step:resumed` and `hook:workflow:resume_rejected` also carry `resumeData`.
- Evaluation order: task-def inputs are evaluated before marking a step as running; task results are stored raw under `$output.<task>`. Final workflow outputs are evaluated only after the flow completes.
- Parallel semantics: child steps start concurrently. Each branch receives an isolated `$output`, `$iteration`, `$accumulator`, and context state snapshot from parallel entry; parent `$output` is merged only when the block resolves. `wait_all` merges branch output deltas in child-index order. `wait_any` uses the first successful branch, aborts siblings with `AbortSignal`, and discards loser outputs. Branches may suspend: the block lets every branch settle (finish or suspend) before suspending, so siblings run exactly once; `wait_any` drops losers' waits once a branch wins. On resume, only branches holding the resolved wait run again.
- Loop semantics:
  - `type: for_each`: iterates over evaluated `for_each.in` (arrays only), threads `$iteration` and accumulator, and optionally checks `until` after each iteration.
  - `type: while`: evaluates `while` before each iteration and then executes loop steps.
  - Accumulated values are exposed under `$output.<loop_name>.<accumulator_alias>` when `name` is set.

## Actions and settings
- Create actions with `defineAction` (or extend `AbstractAction`): provide `name` (snake_case), optional `description`, `inputSchema`, `outputSchema`, optional `settingSchema`, and an async `execute`. `execute` receives an `AbortSignal` as `signal`; long-running actions should stop promptly when it is aborted.
- `AbstractAction.run` handles `parseInput`, merges/parses settings (defaults live in `SettingsSchema`, including `timeout_ms` and retry policy), wraps `execute` with timeout/retries, and validates the output.
- Suspension: inside `execute`, `await context.workflow.suspend(options)`; the runner marks the step as `suspended`, aborts the action's `signal`, and returns `{ status: 'suspended', waits, checkpoint, snapshot }`. On resume the action body re-runs from the top and earlier `suspend()` calls resolve from the checkpoint, so side effects before a `suspend()` must be guarded with `context.workflow.hasRecordedResult()`. A `suspend({ key })` key can be used once per body. Declare the payload with `suspend({ accepts: zodSchema })` rather than throwing on a bad one: a refused payload (by `accepts`, or by the body throwing `WorkflowResumeRejectedError`) leaves the run suspended on the same `waitId` with its checkpoint, snapshot and step log unchanged, and `resume()` returns it as `rejection`. The checkpoint is built through JSON (a `Date` resumes as an ISO string; a `BigInt` in state fails the run), so `accepts` must describe the JSON form of the payload: `suspend()` throws on types JSON cannot carry (`z.date()`, `z.bigint()`, `z.map()`, ...; use `z.coerce.date()` or `z.iso.datetime()`). A resume without payload resolves `undefined`. Retries rewind the suspend cursor through `context.workflow.markSuspendCursor()`, and neither a refused payload nor a `NonDeterministicWorkflowError` is retried. Design: `packages/agentic/SUSPENSION.md`.
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
- `context.workflow.suspend()` works anywhere, including parallel branches. Parallel branch context writes are not kept across a suspension; pass data through `$output`.
- Checkpoint frames name compiled step ids and are never parsed; never derive control-flow position from step id strings.

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
