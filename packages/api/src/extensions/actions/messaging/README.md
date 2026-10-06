Built-in Hexabot actions live here. Add new `.action.ts` files to expose them through the dynamic action registry. Messaging actions return a structured output `{ sent, reply? }`, where `sent` captures the outgoing envelope details; `reply` is typically populated by the dedicated `await_reply` action when resuming.

Available actions:
- `await_reply` — suspends the workflow until a subscriber reply arrives and returns the parsed incoming message. It declares the conversational input schema as the payload it accepts: a reply that does not match it is refused and the run keeps waiting on the same wait.
- `send_text_message` — sends a text envelope and returns the sent metadata.
- `send_quick_replies` — sends text with quick replies and returns the sent metadata.
- `send_buttons` — sends text with buttons and returns the sent metadata.
- `send_attachment` — sends an attachment (with optional quick replies) and returns the sent metadata.
- `send_list` — fetches CMS content and sends it as either a list or a carousel based on settings, then returns the sent metadata.

Common settings:
- `typing` (boolean | number) — optionally emit a typing indicator before sending the message. Provide a number to override the auto-calculated duration.

List-specific settings:
- `content.display` (`list` | `carousel`) — controls whether the content is rendered as a list or carousel.
- `content.fields` — mapping of the content fields to render (`title`, `subtitle`, `image_url`, optional `url`, `action_title`, `action_payload`).
- `content.buttons` — buttons to attach to each content element.
- `content.limit` — maximum number of items to fetch per page; `content.entity` optionally targets a specific content type.
