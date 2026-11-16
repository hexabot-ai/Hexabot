Built-in Hexabot actions live here. Add new `.action.ts` files to expose them through the dynamic action registry. Messaging actions return a structured output `{ sent, reply? }`, where `sent` captures the outgoing envelope details; `reply` is typically populated by the dedicated `await_reply` action when resuming.

Available actions:
- `await_reply` — suspends the workflow until a subscriber reply arrives and returns the parsed incoming message. It declares the conversational input schema as the payload it accepts: a reply that does not match it is refused and the run keeps waiting on the same wait.
- `send_text_message` — sends a text envelope and returns the sent metadata.
- `send_quick_replies` — sends text with quick replies and returns the sent metadata.
- `send_buttons` — sends text with buttons and returns the sent metadata.
- `send_attachment` — sends an attachment (with optional quick replies) and returns the sent metadata.
- `send_list` — fetches CMS content and sends it as either a list or a carousel based on settings, then returns the sent metadata.
- `send_message_to_thread` — sends a message to a subscriber who did not start the run. Unlike the actions above, which answer the event that started the run and so only run in conversational workflows, it runs in every workflow type. See below.

Common settings:
- `typing` (boolean | number) — optionally emit a typing indicator before sending the message. Provide a number to override the auto-calculated duration.

List-specific settings:
- `content.display` (`list` | `carousel`) — controls whether the content is rendered as a list or carousel.
- `content.fields` — mapping of the content fields to render (`title`, `subtitle`, `image_url`, optional `url`, `action_title`, `action_payload`).
- `content.buttons` — buttons to attach to each content element. A `web_url` button links to the content's `url` field (a `uri` field of the content type) when it has a value, else to the button's own `url`; an element with neither gets no such button. Buttons open their link in a new tab: there are no webview options.
- `content.limit` — maximum number of items to fetch per page; `content.entity` optionally targets a specific content type.

## `send_message_to_thread`

The way to message a subscriber from a manual or scheduled workflow (the outcome of an approval, a reminder), or to message someone else than the subscriber a conversation is with. It sends the message as the Inbox does (`OutboundMessageService`, see the channel module README): through the subscriber's channel, then logged in the thread as a message of the chatbot.

Inputs (give `thread_id` or `subscriber_id`, not both):
- `thread_id` (UUID) — the thread to send the message on, open or closed.
- `subscriber_id` (UUID) — the subscriber to send the message to, on their latest open thread. A subscriber without an open thread gets a new one, on their source: a closed thread is never reused.
- `message` (required) — the message, as a standard outgoing envelope `{ type, data }`: `text`, `quickReply`, `buttons`, `list`, `carousel` or `attachment`.

Output: `{ sent: { mid, channel, type, envelope }, thread_id, subscriber_id }`.

The step fails, and nothing is sent, when the thread or the subscriber does not exist, when the subscriber's channel is not registered or cannot address them, or when the channel does not support the format of the message. An error of the channel while sending fails the step too.

The subscriber's reply is an ordinary inbound message: it starts or resumes a conversational workflow, never the run that sent the message. On the web channel, a visitor who stays connected while their thread is closed keeps writing from that closed thread, so their reply opens another thread than the one the message was sent on; reloading the widget moves them to it.

```yaml
defs:
  review:
    kind: task
    action: await_approval
    inputs:
      message: Approve this ambassador request.
  notify:
    kind: task
    action: send_message_to_thread
    inputs:
      subscriber_id: "=$input.subscriber_id"
      message:
        type: text
        data:
          text: "=$output.review.approved ? 'Your request was approved.' : 'Your request was declined.'"
flow:
  - do: review
  - do: notify
outputs:
  thread_id: "=$output.notify.thread_id"
```
