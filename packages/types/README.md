# @hexabot-ai/types

Shared zod-first runtime contracts for Hexabot API entity outputs.

## Migrated Modules

- `analytics`: `Stats*`, `IntegrationHealth*`
- `audit`: `AuditLog*`
- `channel`: `Source*`, `ChannelMetadata*`
- `chat`: `LabelGroup*`, `Label*`, `Subscriber*`, `Thread*`, `Message*`
- `cms`: `ContentType*`, `Content*`, `Menu*`
- `i18n`: `Language*`, `Translation*`
- `setting`: `Setting*`, `Metadata*`
- `user`: `UserProfile*`, `Model*`, `Permission*`, `Role*`, `Credential*`, `McpToken*`, `ApiToken*`, `ApiTokenScope`, `User*`
- `workflow`: `Workflow*`, `WorkflowVersion*`, `WorkflowRun*`, `MemoryDefinition*`, `MemoryRecord*`, `McpServer*`
- `utils/test/dummy`: `Dummy*`
- `attachment`: `Attachment*`

`AuditLog` includes nullable `actorLabel` and `resourceLabel` display fields in
addition to the stable actor/resource identifiers.

`ChannelMetadata` includes `visibility` (`public` or `system`) so clients can
separate customer-facing channels from internal tooling channels.

## Standard Export Pattern

Each migrated entity exposes:

- `*StubSchema`, `*Schema`, `*FullSchema`
- `type *Stub`, `type *`, `type *Full`

Example:

```ts
import {
  subscriberFullSchema,
  type SubscriberFull,
} from "@hexabot-ai/types";

const payload: SubscriberFull = subscriberFullSchema.parse(data);
```

## Shared Chat Message Contracts

Chat message contracts are centralized in `@hexabot-ai/types` and are strictly discriminator-based.

```ts
import {
  ActionOptionsSchema,
  ButtonType,
  FileType,
  IncomingMessageType,
  OutgoingMessageType,
  stdOutgoingMessageSchema,
  attachmentPayloadSchema,
  messageSchema,
  stdIncomingMessageSchema,
  stdOutgoingEnvelopeSchema,
} from "@hexabot-ai/types";
```

### Outgoing Contract (`StdOutgoingMessage`)

All outgoing messages use:

- `{ type, data }`

`type` discriminator variants:

- `text`: `data = { text }`
- `quickReply`: `data = { text, quickReplies }`
- `buttons`: `data = { text, buttons }`
- `attachment`: `data = { attachment, quickReplies? }`
- `list`: `data = { options, elements, pagination }`
- `carousel`: `data = { options, elements, pagination }`

Example:

```ts
const outgoing = stdOutgoingMessageSchema.parse({
  type: OutgoingMessageType.quickReply,
  data: {
    text: "Choose one",
    quickReplies: [{ title: "Yes", payload: "yes" }],
  },
});
```

### Incoming Contract (`StdIncomingMessage`)

All incoming messages use:

- `{ type, data }`

`type` discriminator variants:

- `text`: `data = { text }`
- `postback`: `data = { text, payload }`
- `quickReply`: `data = { text, payload }`
- `location`: `data = { coordinates: { lat, lon } }`
- `attachment`: `data = { serializedText, attachment }`
  `attachment` can be a single attachment or an array.

Example:

```ts
const incoming = stdIncomingMessageSchema.parse({
  type: IncomingMessageType.location,
  data: {
    coordinates: { lat: 36.8, lon: 10.2 },
  },
});
```

### Envelopes and Persistence

- `StdOutgoingMessageEnvelope` is the same contract as `StdOutgoingMessage` (`{ type, data }`).
- `StdOutgoingEnvelope` adds the system envelope variant:
  - `type: OutgoingMessageType.system`
  - `data: { outcome?: string; data?: unknown }`
- Persisted chat message entities (`messageSchema`) validate `message` as:
  - `StdIncomingMessage | StdOutgoingMessage`

Legacy flat payloads and alias-based message shapes are intentionally unsupported.

## Workflow Parser Bridge

Use a parser-aware full workflow schema to preserve `definitionYml` and `definition` derivation:

```ts
import { createWorkflowFullSchema } from "@hexabot-ai/types";

const workflow = createWorkflowFullSchema({
  parseDefinition: (definitionYml) => {
    // API-side parser with binding-aware validation
    return parseWorkflowDefinition(definitionYml);
  },
}).parse(data);
```

You can also build a reusable schema:

```ts
import { createWorkflowFullSchema } from "@hexabot-ai/types";

const schema = createWorkflowFullSchema({ parseDefinition });
const workflow = schema.parse(data);
```

## Workflow Transfer Bundles

Workflow import/export contracts are exposed as zod schemas and inferred types:

```ts
import {
  workflowExportBundleSchema,
  workflowImportResultSchema,
  workflowTransferResourceKindSchema,
  type WorkflowExportBundleV1,
  type WorkflowImportResult,
} from "@hexabot-ai/types";
```

`workflowExportBundleSchema` validates the portable
`hexabot.workflow.bundle` YAML payload. Credential resources include metadata
only; secret `value` fields are intentionally rejected by the strict schema.
Resource arrays include workflow dependencies such as called workflows, memory
definitions, MCP servers, credentials, content types, label groups, and labels.
The root `workflow.exportId` and `resources.workflows` entries preserve
`call_workflow` references across imports. Newer resource arrays default to
empty lists so existing version 1 bundles remain importable.
Extension resource arrays may also be included directly under `resources`; custom
resource result `kind` values are validated with `workflowTransferResourceKindSchema`.

## Alias Compatibility

Common ORM alias mappings from legacy class-transformer DTOs are preserved, including:

- `groupId`, `contentTypeId`, `parentId`
- `sourceId`, `defaultWorkflowId`
- `subscriberId`, `senderId`, `recipientId`, `sentById`, `threadId`
- `ownerId`, `modelId`, `roleId`, `credentialId`
- `currentVersionId`, `publishedVersionId`, `createdById`
- `workflowId`, `workflowVersionId`, `triggeredById`
- `definitionId`, `runId`

Unknown keys are stripped by default.

## Compatibility Notes

- Legacy API enum/type paths can re-export from this package without value changes.
- Schema parsing preserves nullable/optional normalization used by API entity outputs.
- Mixed owner/triggeredBy contracts (`Subscriber | User`) are supported in workflow full contracts.
- Sensitive output parity is preserved for credentials, MCP tokens, and API tokens (`value` and token hashes are not part of output contracts). API token contracts include flat `{ model, action }` scopes for REST bearer authorization.
- Workflow run contracts include `parentRun` for call-and-return workflow stacks.
- Sensitive output parity is preserved for credentials (`value` is not part of output contracts).

## Breaking-Change Notes

- Runtime DTO output classes are replaced by zod schemas + inferred TS types.
- `@Type(() => OutputClass)` patterns should be replaced by direct zod schema parsing.
- Consumers that previously instantiated output DTO classes (`new X()`) must use plain objects typed by exported `type X`.
