# @hexabot-ai/agentic

Typed runtime and YAML DSL for orchestrating multi-step AI/automation workflows. The package combines JSONata-powered expressions, schema validation, and a resumable runner so you can wire LLMs, tools, and human-in-the-loop pauses with reliable execution controls.

## Highlights
- Declarative workflow DSL in YAML or JS objects with JSONata expressions (prefixed by `=`) and clear scopes (`$input`, `$context`, `$output`, `$iteration`, `$accumulator`).
- Type-safe actions built with `defineAction`, Zod-validated IO, and merged settings (timeouts, retries, plus action-specific options) inherited from workflow defaults.
- Resumable execution via `WorkflowRunner` and `context.workflow.suspend`, plus snapshots for persistence and replay.
- Flow primitives: sequential `do`, truly concurrent `parallel` blocks (`wait_all`/`wait_any`), `conditional` branches, and two loop variants: `loop.type: for_each` (iterables) and `loop.type: while` (pre-check condition).
- Event emitter hooks for observability (`hook:workflow:start|finish|failure|suspended`, `hook:step:start|success|error|cancelled|suspended|skipped`).

## Installation

```bash
pnpm add @hexabot-ai/agentic
# or
npm install @hexabot-ai/agentic
```

Requires Node.js >= 24.17.0.

The package ships both ESM (`import`) and CommonJS (`require`) entrypoints plus browser-safe internals, so you can run workflows in Node.js or bundle them for the client.

## DSL essentials

A workflow is a single YAML (or object) that declares inputs, context, defaults, definitions, control-flow, and outputs. The full annotated reference lives in `./DSL.md` and `examples/full/workflow.yml`. The important pieces:

- `inputs.schema`: JSON-schema-like fields validated at runtime.
- `context`: read-only values injected by the host (including any long-term state) and exposed to expressions.
- `defaults.settings`: inherited by every task (timeouts, retries, and action-specific settings).
- `defs`: required root registry for all definitions.
- `defs.<name>` with `kind: task`: executable task defs with `action` and optional `inputs`, `settings`, `bindings`, `description`.
- `defs.<name>` with `kind != task`: binding defs; `settings` is required (use `{}` when empty), with optional `action`, `bindings`, `description`.
- `flow[].do`: must reference a `defs.<name>` entry where `kind: task`.
- `defs.<name>.bindings`: optional kind-based refs on any def (`<kind>: [<defName>...]` for `multiple: true`, `<kind>: <defName>` for `multiple: false`).
- `flow`: ordered list of steps combining `do`, `parallel`, `conditional`, `loop`.
- `outputs`: expressions evaluated after the flow finishes.
- `loop`: must declare `type` (`for_each` or `while`). Legacy loops without `type` are invalid.

Task results are stored automatically under `$output.<task>` for downstream expressions.

When workflows use defs with bindings, pass `bindingKinds` to `Workflow.fromYaml` / `Workflow.fromDefinition`. Each kind descriptor supports `{ schema, multiple, supportedBindings?, actionPolicy? }`.

Binding validation is recursive and enforces cardinality, reference existence, kind matching, duplicate references, cycle detection, and allowlists:
- if a def has `action`, allowlist comes from `actions[action].supportedBindings`.
- otherwise allowlist comes from `bindingKinds[def.kind].supportedBindings`.
- when `actions` are provided at compile time, defs declaring `action` must resolve.

At runtime, mounted bindings follow kind cardinality:
- `multiple: true` kinds mount as `{ [defName]: { settings, action?, bindings? } }`.
- `multiple: false` kinds mount as `{ settings, action?, bindings? }`.

Any string starting with `=` is parsed as JSONata; everything else is literal. Expressions receive `{ input, context, output, iteration, accumulator }` as scope; `$context` resolves to your workflow context state.

## Defining actions

Actions wrap your IO or model calls. `defineAction` enforces schemas and merges settings.

```ts
import { defineAction, Settings, BaseWorkflowContext } from '@hexabot-ai/agentic';
import type { InferWorkflowBindings } from '@hexabot-ai/agentic';
import { z } from 'zod';

class AppContext extends BaseWorkflowContext<{ user_id: string }> {
  log(message: string, payload?: unknown) {
    console.log(message, payload);
  }
}

const bindingKinds = {
  tools: {
    // For non-task kinds, schema validates the "settings" payload.
    schema: z.record(z.string(), z.unknown()),
    multiple: true,
    actionPolicy: 'required' as const,
    supportedBindings: ['tools'] as const,
  },
};
type AppBindings = InferWorkflowBindings<typeof bindingKinds>;

export const call_api = defineAction<
  { id: string },
  { body: string },
  AppContext,
  Settings,
  AppBindings
>({
  name: 'call_api', // must match defs.<task>.action
  description: 'Fetches data from an API',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ body: z.string() }),
  execute: async ({ input, context, settings, bindings, signal }) => {
    if (signal.aborted) {
      throw signal.reason;
    }

    context.log('calling api', {
      id: input.id,
      timeout: settings.timeout_ms,
      tools: bindings.tools ? Object.keys(bindings.tools) : [],
    });
    return { body: `result for ${input.id}` };
  },
});
```

Settings are parsed and merged with workflow defaults before `execute` runs; retries and timeout wrappers are applied automatically. Each action receives an `AbortSignal` as `signal`; long-running actions should stop promptly when it is aborted. Awaiting `context.workflow.suspend(...)` pauses the workflow until `resume` is called, except inside `parallel` branches where suspension fails with `ParallelSuspensionError`.

Parallel branches start concurrently with isolated `$output`, `$iteration`, `$accumulator`, and context state from the parallel entry point. `wait_all` merges successful branch output deltas in child order. `wait_any` advances with the first successful branch, aborts losing branches, and discards loser outputs.

## Running a workflow from YAML

```ts
import { Workflow, WorkflowEventEmitter, BaseWorkflowContext } from '@hexabot-ai/agentic';
import fs from 'node:fs';

const yamlSource = fs.readFileSync('workflow.yml', 'utf8');
const actions = { call_api }; // keys are action names referenced by defs.*.action

class AppContext extends BaseWorkflowContext<{ user_id: string; thread_id: string }> {}

const workflow = Workflow.fromYaml(yamlSource, { actions });

const emitter = new WorkflowEventEmitter();
emitter.on('hook:step:start', ({ step }) => console.log('start', step.id));

const runner = await workflow.buildAsyncRunner();
const context = new AppContext(
  { user_id: 'user-1', thread_id: 'thread-1' },
  emitter,
);
const startResult = await runner.start({
  inputData: { id: '123' },
  context,
});

if (startResult.status === 'finished') {
  console.log('output', startResult.output);
} else if (startResult.status === 'suspended') {
  // persist startResult.snapshot and prompt the user; resume later:
  const resumeResult = await runner.resume({ resumeData: { reply: 'go' } });
  console.log(resumeResult.status, resumeResult.output);
}
```

You can also skip YAML and use `Workflow.fromDefinition` with a typed object that matches `WorkflowDefinition`.
Attach an event emitter to your workflow context (via the constructor or by setting `context.eventEmitter`); it accepts any object with `emit` and `on` methods. `WorkflowEventEmitter` is a small, dependency-free helper with typed payloads (`WorkflowEventEmitterLike` describes the shape).

If your YAML declares `defs.*.bindings`, pass the same `bindingKinds` registry:

```ts
const workflow = Workflow.fromYaml(yamlSource, {
  actions,
  bindingKinds,
});
```

### Minimal YAML example

```yaml
inputs:
  schema:
    user_id:
      type: string
defs:
  greet_user:
    kind: task
    action: call_api
    inputs:
      id: "=$input.user_id"
flow:
  - do: greet_user
outputs:
  reply: "='Hello ' & $output.greet_user.body"
```

## Custom JSONata functions

You can inject additional JSONata functions when compiling a workflow:

```ts
const workflow = Workflow.fromYaml(yamlSource, {
  actions,
  jsonataFunctions: {
    i18n: (text: string) => translate(text, 'fr'),
    slugify: { implementation: (value: string) => value.toLowerCase(), signature: 's' },
  },
});
```

These helpers are registered on every expression and can be referenced from YAML, e.g. `text: "=$i18n('Bye bye')"` inside `defs.<task>.inputs`.

## Suspension and human-in-the-loop

Inside an action you can pause execution and surface metadata to the caller:

```ts
export const await_user = defineAction<unknown, { reply?: string }, AppContext, Settings>({
  name: 'await_user',
  execute: async ({ context }) => {
    const resumeData = await context.workflow.suspend({
      reason: 'awaiting_user',
      data: { prompt: 'Please confirm' },
    });
    return { reply: (resumeData as { reply?: string })?.reply };
  },
});
```

`Workflow.run` throws an error with suspension details (`stepId`, `reason`, `data`) when this happens; `WorkflowRunner.start` instead returns `{ status: 'suspended', ... }` so hosts can persist state and resume later with `runner.resume`.

Suspending actions must not be placed inside `parallel` blocks.

## Events and observability

`WorkflowRunner` can publish lifecycle hooks to any emitter-like object with `emit`/`on` (`WorkflowEventEmitterLike`); `WorkflowEventEmitter` is the built-in helper and mirrors these events:

- `hook:workflow:start | finish | failure | suspended`
- `hook:step:start | success | error | cancelled | suspended | skipped`

Attach listeners to stream logs, emit metrics, or capture snapshots for debugging.

## Examples and scripts

- Full DSL walkthrough and runnable demo: `packages/agentic/DSL.md`, `packages/agentic/examples/full/workflow.yml`, `packages/agentic/examples/full/workflow.ts`, with mock actions in `packages/agentic/examples/full/actions/*`.
- Loop quickstart (`while` loop + suspend/resume): `packages/agentic/examples/loop/workflow.yml` and `packages/agentic/examples/loop/workflow.ts`.
- Suspend/resume quickstart: `packages/agentic/examples/suspend-resume/workflow.yml` and `packages/agentic/examples/suspend-resume/workflow.ts` show pausing a run and resuming with reply data.
- Run the demos with ts-node: `pnpm dlx ts-node packages/agentic/examples/full/workflow.ts`, `pnpm dlx ts-node packages/agentic/examples/loop/workflow.ts`, or `pnpm dlx ts-node packages/agentic/examples/suspend-resume/workflow.ts`.

## Development

From the repository root:

```bash
pnpm --filter @hexabot-ai/agentic build
pnpm --filter @hexabot-ai/agentic test
```

The codebase is TypeScript-first and validated with Zod; expressions use JSONata under the hood.
