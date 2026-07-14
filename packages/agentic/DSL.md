# Agentic Workflow DSL

This document describes the YAML DSL used in `workflow.yml` to orchestrate AI and automation workflows. It is intentionally declarative: the engine provides actions (LLMs, search, email, etc.) and the DSL wires them into a graph of task defs, branches, waits, and loops.

## File layout

- `inputs`: required caller-provided payload. Each key under `schema` declares a JSON schema fragment (`type`, `enum`, `description`, `items`, …).
- `context`: read-only values injected by the runtime (authenticated user, channel, locale, long-term state, etc.).
- `defaults`: settings inherited by every task unless overridden (timeouts, retries, and action-specific knobs).
- `defs`: required root registry for all definitions. Use `kind: task` for executable task defs and other kinds for binding defs.
- `flow`: ordered execution plan composed of `do`, `parallel`, `conditional`, and `loop` blocks.
- `outputs`: expressions that expose final artifacts from the run back to the caller.

## Expressions and scopes

- Any string starting with `=` is evaluated as a JSONata expression. All other strings are treated as literals (quoted or plain).
- Available scopes inside expressions:
  - `$input`: validated caller inputs.
  - `$context`: runtime-provided metadata (including any long-term state you injected).
  - `$output.<task>`: raw results produced by previously executed tasks.
  - `$iteration`: loop locals (`item`, `index`) available inside `loop.steps`.
  - `$accumulator`: loop accumulator state when `accumulate` is used.
- Expressions can declare locals (e.g., `=$route := ...; ...`) and use JSONata helpers like `$exists`, `$size`, `$join`, and `$append`.
- Additional JSONata helpers can be registered at compile time via `Workflow.fromYaml/fromDefinition` using the `jsonataFunctions` option; they are available to every expression (e.g., `text: "=$i18n('Bye bye')"`).

## Task definitions

Each task definition is an entry under `defs` with `kind: task` and has:

- `kind`: must be `task`.
- `description`: human-readable purpose.
- `action`: engine-specific operation to call (`call_llm`, `search_web`, `await_user_input`, etc.). The DSL does not fix action semantics; the runtime must bind them.
- `inputs`: map of parameters passed to the action. Values can be literals or expressions (prefixed with `=`).
- `bindings`: optional map of def refs grouped by kind: `<kind>: [<defName>...]` for `multiple: true` kinds, `<kind>: <defName>` for `multiple: false` kinds.
- `settings`: execution hints (timeout, retries, model choice, temperature, and action-specific options). Settings merge with `defaults.settings`, with task-level keys taking precedence.
- When an action catalog is supplied to validation, task `inputs` and effective action-specific `settings` are checked against that action's schemas. JSONata expression values defer type checks until runtime, while missing required fields are reported during definition validation.

Task results are stored automatically under `$output.<task>` for downstream steps.

Example: `defs.understand_request` calls an LLM with a system prompt, user query, and context; its returned payload is available under `$output.understand_request`.

## Defs and task bindings

- `defs` is a root-level registry with two entry shapes:
  - task defs: `kind: task`, must declare `action`, and may declare `inputs`, `settings`, `bindings`, `description`.
  - non-task defs: `kind` is a binding kind (`tools`, `toolset`, `mcp_server`, etc.), must declare `settings`, and may declare `action`, `bindings`, `description`.
- `defs.<task>.bindings` references other `defs` by name, grouped per kind.
- Validation rules:
  - every referenced def must exist;
  - the referenced def `kind` must exactly match the task binding key;
  - duplicate refs in a single binding list are rejected;
  - workflows that use `defs`/`bindings` require a non-empty `bindingKinds` registry at compile/validation time.
- Runtime mounting:
  - `multiple: true` kinds mount as `{ [kind]: { [defName]: parsedPayload } }`;
  - `multiple: false` kinds mount as `{ [kind]: parsedPayload }`;
  - mounted payload excludes shared def metadata (`kind`, `description`) and contains only kind-schema fields.

## Flow primitives

The `flow` array defines the run order. Each item is exactly one of the following blocks:

- `do`: `{ do: <task_name> }` executes the referenced task sequentially.
- `parallel`: starts every child `step` concurrently. `strategy: wait_all` waits for every child and merges branch output deltas in child order; `strategy: wait_any` advances with the first successful child, aborts the remaining branches, and discards loser outputs.
- `conditional`: branching table evaluated top-to-bottom. Keys:
  - `when`: list of branches with `condition` (JSONata boolean) and `steps` to run on match.
  - `else`: optional branch with `steps` when nothing matches.
- `loop`: explicit loop block with a required discriminator `type`.
  - `type: for_each`:
    - `for_each`: `{ item: <alias>, in: <expression> }` defines the iterable.
    - `until`: optional stop condition checked after each iteration; if `true`, the loop exits early.
    - `max_concurrency`: optional throttle hint (runner currently treats this as metadata).
  - `type: while`:
    - `while`: condition evaluated before each iteration (classic while semantics).
  - shared fields for both variants:
    - `accumulate`: reducer-style state with `as` (name), `initial` (seed value), and `merge` (JSONata expression that receives `$accumulator` and current outputs).
    - `steps`: nested flow blocks (`do`, `parallel`, `conditional`, `loop`).
  - Breaking change: legacy loops without `type` are invalid.

All branches and loop bodies can themselves contain nested `conditional` or `parallel` blocks.

Parallel branches are isolated while they run: each branch sees the `$output`, `$iteration`, `$accumulator`, and context state from the moment the parallel block starts, plus its own writes. Sibling branch outputs are not visible until after the parallel block completes. Tasks inside parallel receive an `AbortSignal` and should stop promptly when it is aborted. Human-in-the-loop suspension is not supported inside parallel branches.

## Human-in-the-loop pauses

- Use a task whose `action` supports waiting (e.g., `await_user_input`) and set `settings.await_user: true`.
- The engine should checkpoint the workflow, wait for a reply or timeout, then resume with the captured response stored under `$output.<task>`.
- Do not place suspending actions inside a `parallel` block. `context.workflow.suspend()` inside parallel fails the workflow with `ParallelSuspensionError`.

## Final outputs

- Keys under the root `outputs` map expose data back to the caller. Each value is an expression evaluated after the flow completes, typically referencing `$output.*` from task defs.
- Example: `missing_fields_resolved` in the example returns `true` when the classifier found no missing fields after the run.

## Execution model and error handling

- Tasks inherit `defaults.settings` unless overridden. Common knobs: `timeout_ms`, `retries.max_attempts`, `retries.backoff_ms`, and action-specific parameters like `model`/`temperature`.
- Engines should surface action failures and retry attempts; a task failing after retries should abort the workflow unless the engine supports optional continuation semantics.
- Parallel blocks honor task-level retries independently. `wait_all` fails fast on the first branch failure and aborts siblings. `wait_any` succeeds on the first successful branch, fails fast on the first branch failure before a winner, and aborts losing branches cooperatively via `AbortSignal`.

## Example walkthrough (`workflow.yml`)

The provided example is the authoritative reference of the DSL in action:

1) Classify the incoming request (`understand_request`), optionally ask the user for missing fields (`ask_for_missing_detail`), and fetch CRM context.  
2) Enrich in parallel with web search, recalled history, and calendar pulls.  
3) Synthesize research, route by intent, and branch into support drafting, sales pitch, or human escalation. High-priority support requests are drafted and then escalated.  
4) Fan out FYI emails to stakeholders via a `loop` with throttling, early exit on first acknowledgement, and an accumulator capturing delivery outcomes.  
5) Send the final email response, selecting the body based on the chosen route.

Notable conventions enforced in the example:

- All expression-bearing strings start with `=` to avoid ambiguity.
- Every task result is stored as-is; downstream steps read from `$output.<task>`.
- The nested conditional in the support branch escalates only when `priority` is `high`; otherwise it continues without redundant fallback work.

## Authoring tips

- Prefer descriptive task def names; keep actions generic and reusable.
- Minimize side effects inside JSONata; use expressions mainly for routing and lightweight data shaping.
- Treat `context` as read-only; write outputs through tasks designed for persistence if needed.
- Keep parallel blocks small when hitting external APIs or rate limits, and make action implementations honor their `AbortSignal`.
- Surface only the essentials in top-level `outputs` so callers get a clean contract.
