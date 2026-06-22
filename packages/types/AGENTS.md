# Agent Handbook - @hexabot-ai/types

Use this file as the entrypoint for AI coding agents working on the Hexabot shared types package. It summarizes package layout, schema conventions, and validation expectations for safe contract changes.

## Scope and precedence
- Scope: applies to `packages/types`.
- Root guidance still applies from `/AGENTS.md`.
- If future sub-folder `AGENTS.md` files are added under this package, the nearest one wins.

## Repository orientation
- Package root: `packages/types`.
- Package docs: `packages/types/README.md`.
- Public entry export: `packages/types/src/index.ts`.
- Domain modules: `packages/types/src/{analytics,attachment,chat,cms,dummy,i18n,setting,user,workflow}`.
- Shared helpers: `packages/types/src/shared/*` (alias mapping, object utilities, preprocess wrapper, base schema pieces).
- Package tests: `packages/types/src/**/*.test.ts` (currently centered in `packages/types/src/index.test.ts`).

## Tooling and commands
- Node.js requirement: `>=24.17.0`.
- Use PNPM workspace commands from repo root.
- Dev watch: `pnpm --filter @hexabot-ai/types run dev`.
- Build (CJS + ESM): `pnpm --filter @hexabot-ai/types run build`.
- Typecheck: `pnpm --filter @hexabot-ai/types run typecheck`.
- Lint: `pnpm --filter @hexabot-ai/types run lint`.
- Lint with fixes: `pnpm --filter @hexabot-ai/types run lint:fix`.
- Tests: `pnpm --filter @hexabot-ai/types run test`.

## Build and publish outputs
- CJS output: `packages/types/dist/cjs`.
- ESM output: `packages/types/dist/esm`.
- Declarations output: `packages/types/dist/types`.
- Package exports are controlled by `packages/types/package.json` and should remain aligned with `src/index.ts` re-exports.

## Contract architecture
- This package is zod-first: runtime validation schemas are the source of truth and TS types are inferred from them.
- Chat message contracts are strict discriminated unions:
  - Outgoing: `{ format, data }` via `StdOutgoingMessageSchema`.
  - Incoming: `{ type, data }` via `stdIncomingMessageSchema`.
  - Outgoing envelope: `StdOutgoingEnvelope` extends outgoing with `system` only.
- Standard entity pattern is:
  - `*StubSchema` for minimal entity shape.
  - `*Schema` for normalized relation IDs.
  - `*FullSchema` for nested relation objects.
  - `type *Stub`, `type *`, `type *Full` inferred from the corresponding schemas.
- Alias compatibility is implemented with `withAliases` in `packages/types/src/shared/aliases.ts` and should preserve legacy API payload keys.
- ID normalization should use shared helpers (`asId`, `asIdArray`) instead of ad-hoc conversions.
- Use the local `preprocess` wrapper from `packages/types/src/shared/preprocess.ts` only when input transformation or normalization is needed; avoid identity preprocess wrappers.
- Workflow full contracts have a parser-aware bridge via `createWorkflowFullSchema` (`packages/types/src/workflow/workflow.ts`) for optional `definition` derivation from `definitionYml`.

## Coding conventions and guardrails
- Preserve the required license header in every TS file; ESLint enforces it.
- Keep file naming and exports consistent with existing style:
  - Files are kebab-case.
  - Runtime schema exports are lower camel case (for example `workflowFullSchema`).
  - TS types are PascalCase (for example `WorkflowFull`).
- Preserve unknown-key stripping behavior unless a change explicitly requires stricter handling.
- Keep alias map behavior backward compatible for existing payload fields unless breaking change work is explicitly requested.
- Do not reintroduce legacy chat payload shapes (for example flat `message.text` outgoing payloads without discriminators or `quick_replies` aliases) unless the task explicitly asks for compatibility.
- Keep enum values stable in domain modules (`src/*/domain.ts`) unless contract changes are requested.
- Do not edit generated outputs directly:
  - `packages/types/dist/**`
  - `packages/types/coverage/**`
  - `packages/types/node_modules/**`

## Testing expectations
- Minimum validation for touched code:
  - `pnpm --filter @hexabot-ai/types run typecheck`
  - `pnpm --filter @hexabot-ai/types run lint`
  - `pnpm --filter @hexabot-ai/types run test`
  - `pnpm --filter @hexabot-ai/types run build`
- When changing aliases, null/optional normalization, or workflow definition derivation, add or update regression tests in `packages/types/src/index.test.ts`.

## Common change recipes
1. Add a new entity module:
- Create the schema file(s) under the relevant domain folder.
- Export symbols from the domain `index.ts`.
- Re-export from `packages/types/src/index.ts`.
- Add parse/alias regression coverage in tests.

2. Add or change alias mappings:
- Update the local `*AliasMap` in the entity schema file.
- Use shared alias helpers to avoid custom transformation drift.
- Verify both alias and canonical field inputs parse correctly.

3. Change workflow full parsing behavior:
- Update `createWorkflowFullSchema` and related preprocessors.
- Keep explicit-field precedence rules intact when both alias and canonical fields are present.
- Add tests for `definitionYml` and parser-derived `definition` behavior.

## Documentation upkeep
- If exported contracts, alias behavior, or migration guidance changes, update `packages/types/README.md` in the same change.
