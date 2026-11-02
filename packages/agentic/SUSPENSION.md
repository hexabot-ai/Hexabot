# Suspension Runtime Design

How `@hexabot-ai/agentic` pauses a workflow run and resumes it later, in the same process or in a
different one.

Core files:

- `src/checkpoint.ts`: frame and checkpoint types, schema, validation
- `src/runner-runtime-control.ts`: `context.workflow` (`suspend`, `hasRecordedResult`)
- `src/step-executors/*.ts`: each executor produces and consumes its own frame
- `src/workflow-runner.ts`: `start`, `resume`, `fromCheckpoint`
- `src/workflow-fingerprint.ts`: definition fingerprint used to detect drift
- `src/resume-payload.ts`: the `accepts` JSON Schema stored on a wait, and payload checks

## 1. Model

A suspended run is described by a **checkpoint**, a plain JSON value. Nothing in memory is
needed to resume it.

Each control-flow executor owns its part of the checkpoint. When a child step suspends, the
executor returns a **frame** holding only the local state it needs to continue. Resuming calls
the **same executor** again with that frame, and the frame seeds those locals. There is no
second code path that rebuilds control flow, and step ids are never parsed.

```ts
// Every executor has this shape. A returned frame means "suspended".
(env, step, state, path, frame?: F) => Promise<F | void>
```

| Frame | Records | On resume |
|---|---|---|
| `sequence` | `index` of the suspended step, `$accumulator` of its scope | restores `$accumulator`, starts at `index`, passes `child` to that step |
| `conditional` | `branchIndex` taken | re-enters that branch; conditions are **not** re-evaluated |
| `loop` | `index`, `accumulator`, `items` (`for_each`) | continues iteration `index` with the recorded items and accumulator; a `while` guard is not re-checked for that iteration |
| `parallel` | per branch: `fulfilled` + `outputDelta`, or `suspended` + `outputDelta` + `child` | fulfilled branches are not launched again; suspended ones re-enter their frame only when this pass resolves one of their waits, and otherwise stay parked as recorded |
| `task` | `inputs`, `awaitResults`, `wait` | see §3 |

A sequence records `$accumulator` because a loop that finished earlier in it replaces the value its
scope started with: after `loop A` completes, `$accumulator` is A's result for the next steps, even
inside an outer loop whose own accumulator the `loop` frame records.

Frames name the **compiled** step id (`stepId`) so validation can line them up with the compiled
flow. Instance ids such as `0.loop.0:ask[2]` are rebuilt by the loop executors as they
re-enter, so snapshot and step-log keys are the same as in an uninterrupted run.

```ts
type WorkflowCheckpoint = {
  version: 1;
  fingerprint: string;              // fingerprintWorkflow(compiled) at suspension time
  input: Record<string, unknown>;
  output: Record<string, unknown>;  // root $output
  root: SequenceFrame;
  waits: WaitInfo[];                // every open wait, in flow order
};

type WaitInfo = {
  waitId: string;     // opaque handle; never parse it
  step: StepInfo;     // instance step that suspended
  suspendKey: string; // `index:<n>` or `key:<key>`
  reason?: string;
  data?: unknown;
  accepts?: JsonSchema;      // relaxed JSON Schema of the payload, see §4
  payloadOptional?: boolean; // `accepts` also takes a resume without payload
};

// In a task frame, each answered `suspend()` call, by suspend key. The value
// is wrapped so that a resume without payload stays answered once JSON drops
// its `undefined` value.
type RecordedResult = { value?: unknown };
```

## 2. Public API

```ts
const result = await runner.start({ inputData, context });
// finished | failed | { status: 'suspended', waits, checkpoint, snapshot }

await runner.resume({ resumeData, waitId });   // waitId optional when one wait is open
// same results as start(); a refused payload gives { status: 'suspended', ..., rejection }

validateCheckpoint(compiled, checkpoint, { waitId?, resumeData? });
// { ok: true, checkpoint } | { ok: false, error: WorkflowResumeError }

const restored = WorkflowRunner.fromCheckpoint(compiled, {
  checkpoint, context, snapshot?, runId?,
});
```

Inside an action, `context.workflow` only suspends (`suspend`, `hasRecordedResult`,
`markSuspendCursor`); resuming is the host's job, through the runner.

`Workflow` wraps these helpers as `validateCheckpoint(checkpoint, options)` and
`buildRunnerFromCheckpoint(options)`. `workflowCheckpointSchema` is exported so hosts can type
and validate the stored column.

In-process and durable resumes share one code path. The checkpoint is built through a JSON round
trip, and `runner.resume()` on a live runner starts from a JSON copy of it, exactly as
`fromCheckpoint` does after a host stored it. Values in `$output` or in resume payloads that are
not plain JSON are therefore seen as a host would store them: a `Date` becomes its ISO string,
and `undefined` values inside them are dropped. This holds for payloads read from `suspend()`,
from the resuming pass on. A resume without payload is the exception:
it stays `undefined` (§3). A run whose state JSON cannot encode (a `BigInt`, a cycle) fails instead
of suspending, and a resume payload JSON cannot encode is refused (§4).

## 3. Suspended tasks

Only task frames run code on resume.

- **The wait is not resolved in this pass**: the frame is returned unchanged and nothing runs.
  This is how a parallel sibling stays parked while another wait is resolved.
- **The wait is resolved**: the resume payload is recorded under the frame's `suspendKey` as
  `{ value }` (a resume without payload is recorded as `{}`, and resolves `undefined` on every
  later pass), and the
  action body **re-runs from the top** with the stored `inputs`, not with re-evaluated inputs.
  Earlier `suspend()` calls resolve immediately from `awaitResults`. The body either completes or
  suspends at a new key, and `hook:step:resumed` is emitted instead of `hook:step:start`.

When a task suspends, its action's `signal` is aborted. The parked body therefore stops its
timeout and retry loop, and suspended time does not count toward `timeout_ms`.

### Action authoring contract

A suspended body runs once, then once more per resolved wait. Side effects performed before a
`suspend()` must be guarded:

```ts
if (!context.workflow.hasRecordedResult()) {
  await spawnChildRun(); // runs once, not once per resume
}
const result = await context.workflow.suspend({ reason: 'awaiting_child' });
```

`hasRecordedResult(key?)` reports whether the next `suspend()` resolves immediately. Steps that
completed never run again, and neither do parallel siblings.

Other rules:

- Always `await` `suspend()`.
- `suspend()` outside a running step throws.
- Keys are positional (`index:<n>`) unless `options.key` is given (`key:<key>`).
- A user `key` can be used once per action body; reusing it throws. Otherwise the second call
  would resolve with the first call's answer on resume instead of suspending.
- A body may change the answers `suspend()` resolves and its `input` in place. Each pass gets its
  own copy of what was recorded, so a change lasts for that pass only and is never replayed.
- Every attempt of an action run rewinds the cursor to where that run started, so a retried body
  reproduces its keys instead of suspending again. `AbstractAction` takes the mark with
  `context.workflow.markSuspendCursor()` before its first attempt and rewinds before each one.
  Because the mark is where the run started, a retried action run nested inside a body resolves
  its own suspends again without rewinding the body's, and an action wrapped by another one
  behaves as if it ran directly. An action with its own retry loop should do the same:

  ```ts
  const rewind = context.workflow.markSuspendCursor?.();
  for (let attempt = 1; ; attempt += 1) {
    rewind?.();
    try {
      return await attemptOnce();
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
    }
  }
  ```

- Declare what a wait accepts with `accepts` instead of throwing on a bad payload (§4). Do not
  loop and `suspend()` again to ask for a new payload: every retry opens a new wait with a new
  `waitId`, so handles already sent go stale, and every refused payload stays in `awaitResults`.

### Determinism checks

A re-run body must reach the suspension it was resumed from. `NonDeterministicWorkflowError`
fails the run when the body:

- reaches an unrecorded suspend key before the expected one;
- reaches the expected key with a different `reason`;
- completes without reaching the expected key.

`AbstractAction` does not retry it: a retry would replay the same body into the same mismatch,
repeating its side effects for nothing.

## 4. Resume payloads

A bad payload must not end the run: the person or system that sent it should be able to send
another one to the same wait. A refused payload leaves the run as it was: same checkpoint, same
open waits and `waitId`s, and the same snapshot and step log. `resume()` then
returns the suspended result with `rejection: { waitId, error }`, where `error` is a
`WorkflowResumeRejectedError` (with `issues` when a schema refused it).

```ts
const { reply } = await context.workflow.suspend({
  reason: 'awaiting_reply',
  accepts: z.object({ reply: z.string() }), // also types the result
});
```

A payload is checked three times, and refused at the first failure:

1. **Before anything runs.** `accepts` is stored on the wait as a JSON Schema.
   `validateCheckpoint(..., { waitId, resumeData })` checks the payload against it, so a host
   can refuse it before claiming the run. `resume()` runs the same check first. Neither runs any
   action code.
2. **When the body reads it.** On resume, `suspend()` parses the payload through the live Zod
   schema and resolves with the parsed value (coercions and defaults applied). If parsing
   fails, `suspend()` rejects with `WorkflowResumeRejectedError`, which covers refinements and
   anything else JSON Schema cannot express.
3. **By the action.** After its `suspend()` resolved, an action may throw
   `WorkflowResumeRejectedError` itself, for checks no schema can express, such as an unknown
   order id.

Before either check, the payload goes through the same JSON round trip as the checkpoint, so
every check sees what the body will read. A payload JSON cannot encode is refused.

`accepts` therefore describes the payload **in its JSON form**. A `Date` sent to `resume()`
reaches the schema as its ISO string, so declare `z.coerce.date()` or `z.iso.datetime()`, not
`z.date()`. A schema using a type JSON cannot carry (`z.date()`, `z.bigint()`, `z.map()`,
`z.set()`, `z.nan()`, `z.symbol()`, `z.function()`, `z.file()`), anywhere outside a coerced,
preprocessed or `catch` node, could never be resumed, so `suspend()` throws a `TypeError` naming
those parts instead of opening the wait.

A resume without payload is not a JSON value. It stays `undefined`: `suspend()` resolves with
`undefined`, and the task frame records the answer as `{}`. JSON Schema cannot say whether
`undefined` is accepted, so the wait carries `payloadOptional: true` when the `accepts` schema
takes it (`.optional()`, `.default()`, `.nullish()`, ...); otherwise the first check refuses a
missing payload.

When the body refuses a payload (checks 2 and 3), the step goes back to `suspended`, and
`hook:step:resume_rejected` is emitted after `hook:step:resumed`. Only the refusing task ran in
that pass and it did not complete, so the runner keeps the checkpoint it resumed from and puts
back the snapshot and step log it had before the pass. Parked parallel siblings are
not cancelled. `AbstractAction` does not retry a refusal, since a retry would read the same
payload. What the runner does not own is not rolled back: the events of the refused pass stay
emitted, and side effects the body performs between reading the payload and refusing it,
including writes to context state, are not undone.

The JSON Schema is **relaxed** so that it never refuses a JSON payload the Zod schema would
accept. Coerced, preprocessed, `catch` and custom nodes accept anything. Keywords that do not
survive `z.fromJSONSchema` exactly (`pattern`, `format`, `propertyNames`, ...) are dropped, and
so are length and range bounds of a node with a rewrite such as `.trim()`. Any looser check here
is caught by the live schema in step 2.

A `WorkflowResumeRejectedError` counts as a refusal only when the task was resumed and its body
has reached the `suspend()` call being resolved. Thrown anywhere else, it fails the run like any
other error. It is recognised by its `name` as well as its class, so an extension that imports
the other (CJS or ESM) build of this package can throw it too; `AbstractAction` recognises
`NonDeterministicWorkflowError` the same way. If a payload accepted by an earlier pass no longer
parses, because the schema changed between deployments, the run fails with
`NonDeterministicWorkflowError`.

## 5. Parallel blocks

Branches may suspend. Each branch runs in its own runtime scope (its own `context.workflow`), so
concurrent branches suspend independently.

- **Settle, then suspend.** The block waits until every branch has completed, failed or suspended.
  A sibling that was still running finishes before the run suspends, so it runs exactly once and
  is recorded as `fulfilled`.
- **`wait_all`** suspends with every suspended branch's wait open, and completes once all are
  resolved. A failing branch cancels the others, drops the open waits and fails the block.
- **`wait_any`**: the first branch to complete wins. Losing branches are cancelled, and their open
  waits are dropped and marked `cancelled`. If every branch suspends, the block suspends and the
  first resolved branch to complete wins later.
- **Dropping waits.** A branch can suspend while it is being cancelled, after a sibling won or
  failed. Its wait was opened all the same, so the block lets every branch settle, then drops
  the waits of every branch left suspended: each gets `hook:step:cancelled` with its `wait`, and
  its snapshot and step log say `cancelled`.
- **Resuming.** Only branches holding the resolved wait are launched again. The other parked
  branches keep their recorded frame and output delta, without a new runtime scope or copies of
  `$output`, context state and `$accumulator`.
- **Outputs.** Branch output deltas are recorded in the frame and merged in branch order when the
  block completes, exactly as in an uninterrupted run.
- **Context.** A branch's writes to context state are local to the branch and are not kept
  across a suspension. On resume the branch context is re-cloned from the host-hydrated context.
  Pass data between steps through `$output`.

## 6. Validation and errors

`validateCheckpoint` runs no action and needs no context. It checks, in order:

1. presence (`WorkflowCheckpointInvalidError`, `code: 'missing'`);
2. `version` (`code: 'unsupported_version'`), then schema (`code: 'malformed'`, with `issues`);
3. fingerprint against the compiled workflow (`WorkflowDefinitionDriftError`, `expected`/`actual`);
4. every frame against the compiled step it names: kind, id, branch or loop index, parallel
   branch count (`code: 'structure'`, with `path`);
5. `waits` against the task frames (`code: 'structure'`);
6. when `waitId` or `resumeData` is given, the wait `resume()` would resolve: `waitId` must be
   open (`WorkflowWaitNotFoundError`, with `openWaitIds`), and without it exactly one wait must
   be open (`WorkflowWaitAmbiguousError`, with `openWaitIds`);
7. that `resumeData`, when the key is given, is accepted by that wait
   (`WorkflowResumeRejectedError`, with `issues`).

All of these extend `WorkflowResumeError`. `fromCheckpoint` throws the same errors (except
the wait and payload checks). `resume()` picks the wait exactly as check 6 does and throws the
same two errors, so a request `validateCheckpoint` accepted never fails there. `resume()` does
not throw for a refused payload; it returns the `rejection`.

The fingerprint covers step ids, labels, types, task inputs, conditions, loop expressions,
accumulators and output mappings. A renamed task, an inserted step or a changed `until`
expression is therefore caught before anything runs.

## 7. Events

| Event | When | Wait fields |
|---|---|---|
| `hook:step:suspended` | a task suspends | `wait` it opened |
| `hook:workflow:suspended` | the run suspends | `waits`: every open wait, in flow order |
| `hook:step:resumed` | a suspended task re-runs its body after its wait was resolved | `wait` it resolved, `resumeData` as recorded |
| `hook:step:resume_rejected` | a resumed task refused its payload and is suspended again on the same wait | `wait`, `error` |
| `hook:workflow:resume_rejected` | a resume payload was refused (by `accepts` or by the body) | `wait`, `resumeData` as passed to `resume()`, `error` |
| `hook:step:cancelled` | a step is cancelled; for a parked wait, it is dropped (`wait_any` loser, failing sibling, branch that suspended while cancelled) | `wait` it dropped, when it held one |

Every event about a wait carries its `WaitInfo`, so a host can match it by `waitId` to what it
keeps for that wait. For example, a notification sent or an expiry scheduled on
`hook:step:suspended` can be withdrawn on the `hook:step:cancelled` of the same wait. Together,
`hook:step:resumed` and `hook:workflow:resume_rejected` record who answered what, accepted or
refused, which is enough for an approval audit trail. `resumeData` on `hook:step:resumed` has been
through the checkpoint's JSON round trip. Payloads can hold personal data, so decide what to keep
before forwarding them.

## 8. Host integration

A host persists, per suspended run:

- `checkpoint`: one JSON column; the only thing needed to resume;
- `snapshot`: to keep reporting the status of past steps;
- optionally values denormalized from `waits` (step, reason, data) for querying and routing.

To resume a wait, typically from an HTTP request:

1. load the run and compile its pinned definition;
2. `validateCheckpoint(compiled, run.checkpoint, { waitId, resumeData })`, and refuse the
   request on `ok: false`, before claiming anything. A `WorkflowResumeRejectedError` means the
   payload is wrong (e.g. HTTP 422), and a `WorkflowWaitAmbiguousError` that the request must
   name a `waitId` (e.g. HTTP 400); the others mean the wait cannot be resumed;
3. claim the run (optimistic lock); two resumes of different waits of the same run must not
   interleave. Claim the suspension that was validated (a version or a suspension timestamp),
   not only the status: otherwise a caller holding a stale checkpoint can claim a run another
   caller resumed and suspended again in the meantime. Make the claim a lease with a token:
   renew it while the pass runs, and leave the checkpoint as it is, so that a run whose process
   died (its lease lapsed) can be put back on the checkpoint it was claimed from and resumed
   again;
4. `fromCheckpoint(...)`, then `resume({ waitId, resumeData })`;
5. persist the new checkpoint (or clear it when the run finished or failed), only while the run
   is still held under the token: a pass whose run was recovered or taken over meanwhile must
   drop its outcome. When the result carries `rejection`, the checkpoint is unchanged: release
   the claim and refuse the request, leaving the run suspended.

A payload refused by `validateCheckpoint` in step 2 never reaches the runner, so no
`hook:workflow:resume_rejected` is emitted for it; a host that keeps an audit trail of refusals
records those itself.

## 9. Tests

- `src/__tests__/checkpoint.test.ts`: every fixture runs twice, once resumed in process and once
  with a JSON round trip into a brand-new compiled workflow, runner and context after each
  suspension. Both passes must produce the same outputs and the expected per-action body counts.
  Fixtures cover sequences, output values that are not plain JSON, conditionals, `for_each`
  accumulators reading `$iteration.item`, nested `for_each` + `while`, multi-suspend actions,
  an action changing its input and answers in place, `wait_all` with two waits in both orders, both `wait_any` outcomes, and a loop inside parallel
  inside a loop. The file also covers every validation error (including each frame structure
  check), retry after resume, timeouts, failing siblings, `waitId` selection, recorded inputs,
  nested action runs, reused keys, all three determinism checks, and the suspension and
  cancellation events. It also covers resume payloads: refusal by `accepts` before and after
  claiming, refusal by the body and by the action, no retry of a
  refusal, payloads JSON cannot encode, and refusals inside `wait_all`, `wait_any` and loops.
  Regression tests cover `$accumulator` after a finished loop (at the root and inside an outer
  loop), a branch suspending while it is cancelled (swept over when the suspension lands, for
  both strategies and branch orders), the step log of dropped waits, wait selection shared by
  `validateCheckpoint` and `resume()`, optional payloads, schemas JSON cannot satisfy,
  refusals thrown by another copy of the package, no retry of `NonDeterministicWorkflowError`,
  retried nested and wrapped action runs, and what a refused resume leaves unchanged.
- `src/__tests__/resume-payload.test.ts`: the relaxed `accepts` JSON Schema never refuses what
  the Zod schema accepts, still refuses what JSON Schema can check, optional payloads, types
  JSON cannot carry, and payload normalization.
- `src/__tests__/runner-runtime-control.test.ts`: the suspend cursor and its rewinds, keys,
  recorded results (handed out as copies), `accepts` parsing, and determinism checks of one
  runtime scope.
- `src/__tests__/workflow-fingerprint.test.ts`: which definition changes count as drift.
- `src/step-executors/*.test.ts`: frame production and consumption per executor.
- `src/__tests__/workflow-runner.test.ts`: runner-level suspend and resume, restoring from
  persisted checkpoints, `hasRecordedResult`.
- `src/__tests__/workflow.test.ts`: the `Workflow` checkpoint helpers and the error `run()` throws.
