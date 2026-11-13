# AI actions

`ai_agent`, `ai_generate_text`, `ai_generate_reply`, `ai_generate_object` and `ai_infer_object` call a language model through the Vercel AI SDK. They share their settings (`aiCommonSettingsSchema`) and the tool loop described here.

## Step limit

When tools are bound (`tools`, `mcp` or `memory` bindings), the model works in steps. A step is one model call: the model either answers, which ends the action, or calls tools, whose results feed the next step. Several tool calls made in the same step count as one step.

`stop_step_count` ("Max steps") caps the number of steps.

- **Default:** 10 (`DEFAULT_AI_STOP_STEP_COUNT`), whatever the number of tools. Without tools the model answers in one step and no limit applies.
- **The last step is reserved for the answer.** When more than one step is allowed, the system prompt of the last one tells the model that its tool budget is used up and that it must answer with what it has. With `stop_step_count: 4`, the model can use tools for up to three steps and answers on the fourth.
- **A single step keeps its tools.** `stop_step_count: 1` is one model call that may call tools and stop there, for workflows that only read `tool_calls` and `tool_results`.
- `stop_tool_call` ends the action as soon as the named tool is called, on any step.

The limit bounds a tool loop that does not converge; it is not a target. Raise it for tasks that need many rounds of tool calls.

### When the limit is reached

The instruction on the last step is not a guarantee: a model can still answer with a tool call. The action then ends without a final answer:

- `step_limit_reached` is `true` in the output (`false` otherwise), `finish_reason` is `tool-calls`, and `text` is empty or partial. Branch on it before sending a reply:

  ```yaml
  - conditional:
      when:
        - condition: =$output.answer.step_limit_reached
          steps:
            - do: apologize
        - else: true
          steps:
            - do: send_answer
  ```

- `ai_generate_object` and `ai_infer_object` throw, with an error naming the limit, since there is no object to return.
- A warning is logged, except for a single step, where stopping on the tool call is what the workflow asked for.

The tools stay declared on the last step. Disabling them (`toolChoice: 'none'`) is not portable: the Bedrock provider then removes the tool calls and results from the conversation, and the model would answer without what it retrieved.
