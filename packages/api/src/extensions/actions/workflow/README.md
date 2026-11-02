Built-in workflow-control actions. They pause a run until something outside it answers: another workflow run, or an admin.

## Actions

- `call_workflow` — starts another workflow of the same type and waits until its run ends. The child's output becomes the step output; a failed child fails the step. Deleting the called workflow while a caller waits on it fails the step with `Called workflow <id> was deleted`, and cancels the runs the deleted runs had called in turn. A called run whose result nothing waits on any more is cancelled with its own called runs (`Calling workflow run <id> no longer waits on this run`), so an admin can no longer approve it and it receives no further events. This happens when the step is dropped (a `wait_any` branch that lost the race, a branch cancelled by a failing sibling) or when the caller ends first (cancelled, failed, or deleted with its workflow while the called run was still running).
- `await_approval` — suspends the run until an admin approves or rejects the request.
- `suspend_workflow` — suspends the run until an admin resumes it, optionally with data.

### `await_approval`

Inputs:
- `message` (string, required) — what the admin is asked to approve.
- `details` (JSON object, optional) — data shown to the admin to support the decision.

Settings:
- `on_reject` (`continue` | `fail`, default `continue`) — on a rejection, either continue with `approved: false`, or fail the run with `Rejected by <admin>[: <comment>]`.

Output: `{ approved, decision, decided_by: { id, name }, decided_at, comment? }`. The API fills in `decided_by` and `decided_at` from the authenticated admin; clients only choose the decision and the comment.

### `suspend_workflow`

Inputs:
- `message` (string, optional) — what the admin is asked to do before resuming.
- `details` (JSON object, optional) — data shown to the admin.

Settings:
- `payload_schema` (JSON Schema, optional) — the data the admin must send. Without it, any JSON object is accepted. A schema zod cannot read fails the step before it suspends.

Output: `{ data, resumed_by: { id, name }, resumed_at }`.

### Example

```yaml
defs:
  collect_reference:
    kind: task
    action: suspend_workflow
    inputs:
      message: Supply the external reference before continuing.
    settings:
      payload_schema:
        type: object
        properties:
          reference: { type: string, minLength: 3 }
        required: [reference]
  review:
    kind: task
    action: await_approval
    inputs:
      message: Approve processing this reference.
      details:
        reference: "=$output.collect_reference.data.reference"
    settings:
      on_reject: continue
  process:
    kind: task
    action: http_request
    inputs:
      url: https://example.com/process
      body: "=$string({ 'reference': $output.collect_reference.data.reference })"
    settings:
      method: POST
flow:
  - do: collect_reference
  - do: review
  - conditional:
      when:
        - condition: "=$output.review.approved"
          steps:
            - do: process
outputs:
  approved: "=$output.review.approved"
  approved_by: "=$output.review.decided_by.name"
```

## Resolving admin waits

The run keeps status `suspended`. Its `checkpoint.waits` lists each open wait: `waitId`, `step`, `reason` (`awaiting_approval` or `awaiting_resume`) and `data` (the step's `message`, `details` and `payload_schema`). `awaitingOperator` is `true` while the run waits on an admin.

Endpoints (session and CSRF token required, like every other mutating route):

| Route | Permission | Body |
| --- | --- | --- |
| `GET /api/workflowrun/pending` | `workflowrun:read` | Runs waiting on an admin, latest suspension first. Accepts the run list filters and pagination. |
| `GET /api/workflowrun/pending/count` | `workflowrun:read` | Their count. |
| `PATCH /api/workflowrun/:id/approve` | `workflowrun:update` | `{ waitId?, comment? }` |
| `PATCH /api/workflowrun/:id/reject` | `workflowrun:update` | `{ waitId?, comment? }` |
| `PATCH /api/workflowrun/:id/resume` | `workflowrun:update` | `{ waitId?, data? }` (`data` defaults to `{}`) |
| `PATCH /api/workflowrun/:id/cancel` | `workflowrun:update` | `{ reason? }` |

`waitId` is optional when the run has a single wait of the kind the route resolves. Approve, reject and resume check the decision and claim the run, then answer `202 Accepted` with the run as it stands (`status: 'running'`, with its checkpoint; the same shape as `GET /api/workflowrun/:id`). The rest of the run goes on in the background: the steps up to its next wait or its end, the workflows it calls, and the parent runs waiting on it. Those can take minutes, longer than a proxy in front of the API waits for a response. Follow the run through `GET /api/workflowrun/:id` or the run's live updates. Cancel answers `200` with the failed run.

Errors carry a `code`:

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `wait_ambiguous` | Several waits of that kind are open; pass one of `openWaitIds`. |
| 400 | `wait_kind_mismatch` | `waitId` is another kind of wait (e.g. approving a resume wait). |
| 404 | | The run does not exist. |
| 409 | `run_not_suspended` | The run is running, finished or failed. |
| 409 | `wait_not_found` | `waitId` is not open (any more). |
| 409 | `no_matching_wait` | The run has no wait of that kind. |
| 409 | `claim_lost` | Another request resumed or cancelled the run first. |
| 409 | `trigger_unavailable` | The run's trigger cannot be rebuilt (`reason`: closed conversation, deleted initiator, disabled source or channel). |
| 409 | `unresumable` | The run can never resume (its checkpoint no longer matches its definition); it was marked failed. |
| 409 | `resume_unavailable` | The run could not be resumed right now (e.g. its definition no longer compiles) and still waits. |
| 422 | `payload_rejected` | The wait refused the payload (`issues`); the run still waits on the same wait. |

On a 409, reload the run before trying again. These errors are all detected before the run is claimed. After the `202`, a run that fails (e.g. `on_reject: fail`) shows `status: 'failed'` in its updates. In the rare case where a step refuses the payload while it runs (a check its `accepts` schema could not express), the refusal is logged and the run goes back on the same wait.

Cancelling fails the run with `Cancelled by <admin>[: <reason>]`, marks the steps that held open waits `cancelled`, cancels the suspended runs it called, and passes a failed result to a parent run waiting on it; that parent goes on in the background. Every operation is recorded in the audit log (`workflowrun.approve|reject|resume|cancel`); comments and data are not.

## While a run waits on an admin

- **Conversations.** Messages in the run's conversation are stored, but neither resume the run nor start a new one, so they do not interleave with the pending decision. They are not replayed afterwards. A run of the conversation that waits on a reply still gets them, e.g. the run that called this one and asks the user in a `parallel` branch beside the call. A decision is accepted even while the subscriber is handed over to a human agent; the resumed run may then send messages alongside the agent.
- **Manual, webhook and scheduled triggers** start a new, independent run. A scheduled workflow that waits on approvals therefore leaves one pending run per tick.
- Approving a wait of a child run resumes its waiting ancestors once the child ends.
- Waits do not expire. Closing the conversation fails the run.
- If the API process stops while the run goes on after a decision (a crash or a deploy), the run goes back to the pending list on the same wait, within about 1.5 × `WORKFLOW_RUN_CLAIM_TTL` (60 s by default): decide again. Steps that ran after the wait in the interrupted attempt run again. Until then, the endpoints answer 409 `run_not_suspended`. A run interrupted 3 times in a row is cancelled.
