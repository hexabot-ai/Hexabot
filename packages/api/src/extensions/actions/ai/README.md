# AI actions

`ai_agent`, `ai_generate_text`, `ai_generate_reply`, `ai_generate_object` and `ai_infer_object` call a language model through the Vercel AI SDK. They share their settings (`aiCommonSettingsSchema`) and the tool loop described here.

## Step limit

When tools are bound (`tools`, `mcp` or `memory` bindings), the model works in steps. A step is one model call: the model either answers, which ends the action, or calls tools, whose results feed the next step. Several tool calls made in the same step count as one step.

`stop_step_count` ("Max steps") caps the number of steps.

- **Default:** 10 (`DEFAULT_AI_STOP_STEP_COUNT`), whatever the number of tools. Without tools the model answers in one step and no limit applies.
- **The last step is reserved for the answer.** When more than one step is allowed, the last one has no tools: the model can only answer. With `stop_step_count: 4`, the model can use tools for up to three steps and answers on the fourth.
- **A single step keeps its tools.** `stop_step_count: 1` is one model call that may call tools and stop there, for workflows that only read `tool_calls` and `tool_results`.
- `stop_tool_call` ends the action as soon as the named tool is called. The step reserved for the answer has no tools, so the tool cannot be called there.

The limit bounds a tool loop that does not converge; it is not a target. Raise it for tasks that need many rounds of tool calls.

### When the limit is reached

A model that used tools on every step before the last one has to answer on it, with what it gathered by then:

- `step_limit_reached` is `true` in the output (`false` otherwise) and `text` holds the answer, which may say what is missing. The answer can be sent as it is. Branch on the flag to treat it differently, for instance to hand the conversation over:

  ```yaml
  - do: send_answer
  - conditional:
      when:
        - condition: =$output.answer.step_limit_reached
          steps:
            - do: hand_over
  ```

- `ai_generate_object` and `ai_infer_object` generate their object on that step.
- A warning is logged.
- No tool runs on the last step. The tool calls and results of the earlier steps stay in `tool_calls`, `tool_results` and `steps` as they were made.

The last step cannot call a tool, but like any model call it can return nothing (a content filter, an output token limit), so an empty `text` is still possible.

With `stop_step_count: 1` there is no step for the answer: `step_limit_reached` is `true` when the single step ended on a tool call, no warning is logged since that is what the workflow asked for, and `ai_generate_object` and `ai_infer_object` throw an error naming the limit, as they have no object to return.

### How the last step is built

Declaring no tools is not enough: a call without tools cannot carry tool calls and results on every provider. Bedrock refuses them, so its provider removes them from the conversation; the model then answers without what it retrieved, or the call fails because the conversation ends on the model's own text.

So the last step gets a rewritten copy of the conversation (`buildFinalStepMessages` in `ai-final-step.ts`):

- Each tool result becomes text, with the name of its tool and the input of its call, in a user message.
- The model's own messages keep their text only.
- The conversation ends on a user message that asks for the final reply (`AI_FINAL_STEP_INSTRUCTION`). The system prompt is not changed.

Only that model call sees the rewritten copy.
