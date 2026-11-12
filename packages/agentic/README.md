# @hexabot-ai/agentic

Typed runtime and YAML DSL for orchestrating multi-step AI/automation workflows. The package combines JSONata-powered expressions, schema validation, and a resumable runner so you can wire LLMs, tools, and human-in-the-loop pauses with reliable execution controls.

## Highlights
- Declarative workflow DSL in YAML or JS objects with JSONata expressions (prefixed by `=`) and clear scopes (`$input`, `$context`, `$output`, `$iteration`, `$accumulator`).
- Type-safe actions built with `defineAction`, Zod-validated IO, and merged settings (timeouts, retries, plus action-specific options) inherited from workflow defaults.
- Durable, resumable execution via `WorkflowRunner` and `context.workflow.suspend`: a suspended run yields a JSON checkpoint that any process can resume, including suspensions inside `parallel` blocks.
- Flow primitives: sequential `do`, truly concurrent `parallel` blocks (`wait_all`/`wait_any`), `conditional` branches, and two loop variants: `loop.type: for_each` (iterables) and `loop.type: while` (pre-check condition).
- Event emitter hooks for observability (`hook:workflow:start|finish|failure|suspended|resume_rejected`, `hook:step:start|resumed|resume_rejected|success|error|cancelled|suspended|skipped`).

## Installation

```bash
pnpm add @hexabot-ai/agentic
# or
npm install @hexabot-ai/agentic
```

Requires Node.js >= 24.22.1.

The package ships both ESM (`import`) and CommonJS (`require`) entrypoints plus browser-safe internals, so you can run workflows in Node.js or bundle them for the client.

## DSL essentials

A workflow is a single YAML (or object) that declares inputs, context, defaults, definitions, control-flow, and outputs. The full annotated reference lives in `./DSL.md` and `examples/full/workflow.yml`. The important pieces:

- `inputs.schema`: JSON Schema (root `type: object`) of the payload a run is started with. The payload is checked against it before anything runs, and its `default` values are filled in.
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

Settings are parsed and merged with workflow defaults before `execute` runs; retries and timeout wrappers are applied automatically. Each action receives an `AbortSignal` as `signal`; long-running actions should stop promptly when it is aborted. Awaiting `context.workflow.suspend(...)` pauses the workflow until `resume` is called; see [Suspension and human-in-the-loop](#suspension-and-human-in-the-loop).

Parallel branches start concurrently with isolated `$output`, `$iteration`, `$accumulator`, and context state from the parallel entry point. `wait_all` merges successful branch output deltas in child order. `wait_any` advances with the first successful branch, aborts losing branches, and discards loser outputs. Branches may suspend: the block waits for every branch to finish or suspend, then suspends with one open wait per suspended branch.

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
  // Persist startResult.checkpoint (plain JSON) and prompt the user; later:
  const restored = workflow.buildRunnerFromCheckpoint({
    checkpoint: startResult.checkpoint,
    snapshot: startResult.snapshot,
    context,
  });
  const resumeResult = await restored.resume({
    waitId: startResult.waits[0].waitId,
    resumeData: { reply: 'go' },
  });
  console.log(resumeResult.status);
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
    type: object
    properties:
      user_id:
        type: string
    required: [user_id]
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

### Workflow inputs

`runner.start({ inputData })` checks `inputData` against `inputs.schema` and throws a `WorkflowInputRejectedError` (with `issues`, one `<path>: <message>` line each) when it does not match; nothing has run at that point. A host that wants to refuse a payload before creating a run can build the same parser with `buildWorkflowInputParser(definition.inputs?.schema)`.

> **Breaking change.** `inputs.schema` used to be a map of fields (`{ user_id: { type: string } }`) and is now a JSON Schema. Definitions in the old form fail validation with a message naming the expected format, and the `InputField` type is replaced by `WorkflowInputSchema`. To convert a definition, move the fields under `properties` and add `type: object`; add `additionalProperties: false` to keep refusing undeclared keys, which the old form always did. See `DSL.md` ("Workflow inputs").

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
export const await_user = defineAction<unknown, { reply: string }, AppContext, Settings>({
  name: 'await_user',
  execute: async ({ context }) => {
    const { reply } = await context.workflow.suspend({
      reason: 'awaiting_user',
      data: { prompt: 'Please confirm' },
      accepts: z.object({ reply: z.string() }),
    });
    return { reply };
  },
});
```

`accepts` declares the payload the wait accepts and types what `suspend()` resolves with. A payload that does not match it is refused without failing the run: the run stays suspended on the same wait, with the same `waitId`. An action can also refuse a payload it has read by throwing `WorkflowResumeRejectedError`.

Payloads are stored as JSON, so `accepts` sees a payload in its JSON form: a `Date` arrives as its ISO string, and a resume without payload arrives as `undefined` (make the schema `.optional()` to allow it). Declare the JSON form, e.g. `z.coerce.date()` or `z.iso.datetime()` rather than `z.date()`; `suspend()` throws when part of the schema is a type JSON cannot carry, since no payload could ever resume that wait.

`WorkflowRunner.start` and `resume` return `{ status: 'suspended', waits, checkpoint, snapshot }` when a run pauses. `Workflow.run` throws an error carrying the same `waits`.

- **`waits`** lists every open wait (`waitId`, `step`, `suspendKey`, `reason`, `data`, and `accepts`, a JSON Schema of the payload when the action declared one, with `payloadOptional` when it may be left out). A run can hold several when branches of a `parallel` block suspend. `waitId` is opaque; do not parse it.
- **`checkpoint`** is plain JSON holding everything needed to resume: the frames of the suspended control flow (sequence positions, chosen branches, loop items and accumulators, parallel branch outcomes), the outputs so far, and the suspended tasks' inputs and earlier resume payloads. Persist it as-is. It is built through JSON, so a resumed run sees the same values in process and after a restore (a `Date` becomes its ISO string); a run whose state JSON cannot encode, such as a `BigInt`, fails instead of suspending.

To resume, possibly in another process:

```ts
const resumeData = { reply: 'go' };
const validation = workflow.validateCheckpoint(stored.checkpoint, { waitId, resumeData });
if (!validation.ok) {
  // WorkflowCheckpointInvalidError | WorkflowDefinitionDriftError | WorkflowWaitNotFoundError
  // | WorkflowWaitAmbiguousError (several waits are open and no waitId was given)
  // | WorkflowResumeRejectedError (the payload does not match what the wait accepts)
  throw validation.error;
}

const runner = workflow.buildRunnerFromCheckpoint({
  checkpoint: stored.checkpoint,
  snapshot: stored.snapshot,
  context,
});
const result = await runner.resume({ waitId, resumeData });
if (result.status === 'suspended' && result.rejection) {
  // Refused payload: the checkpoint, snapshot and step log are unchanged, the wait is still open.
}
```

`validateCheckpoint` runs no action and needs no context, so hosts can call it before claiming a wait. It checks a payload against the same wait `resume` would resolve: `waitId` may be omitted from both only when exactly one wait is open.

Resuming skips every step that already completed. The suspended action's body **runs again from the top**: `suspend()` calls it already made resolve immediately with their recorded results, including the one being resumed. Guard side effects that happen before a `suspend()` with `context.workflow.hasRecordedResult()`:

```ts
if (!context.workflow.hasRecordedResult()) {
  await sendPrompt(); // runs once, not once per resume
}
const reply = await context.workflow.suspend({ reason: 'awaiting_user' });
```

When an action suspends, its `signal` is aborted and its timeout stops counting; suspended time does not count toward `timeout_ms`. An action that implements its own retry loop instead of relying on `AbstractAction` should call `context.workflow.markSuspendCursor?.()` before its first attempt and the returned rewind function before each attempt, so a retry resolves the same `suspend()` calls again. See [SUSPENSION.md](./SUSPENSION.md) for the full design.

## Events and observability

`WorkflowRunner` can publish lifecycle hooks to any emitter-like object with `emit`/`on` (`WorkflowEventEmitterLike`); `WorkflowEventEmitter` is the built-in helper and mirrors these events:

- `hook:workflow:start | finish | failure | suspended | resume_rejected`
- `hook:step:start | resumed | resume_rejected | success | error | cancelled | suspended | skipped`

Events about a wait (`hook:step:suspended`, `resumed`, `resume_rejected`, and `cancelled` when it drops a parked wait, plus `hook:workflow:resume_rejected`) carry its `wait` (`WaitInfo`), so hosts can match them by `waitId`. `resumed` and `hook:workflow:resume_rejected` also carry `resumeData`.

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
