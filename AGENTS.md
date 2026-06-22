# Agent Handbook - Monorepo Root

This file defines repository-wide instructions for AI coding agents working in the Hexabot monorepo.

## Scope and precedence
- Scope: applies to the entire repository.
- More specific `AGENTS.md` files exist under `packages/*` and should be treated as the primary source when working in those directories.
- Precedence rule: nearest `AGENTS.md` to the changed file wins when guidance conflicts.
- For cross-package changes, follow this root file plus each relevant package-level file.

## Monorepo layout
- Workspace manager: PNPM (`pnpm@9.12.0`).
- Task orchestrator: Turborepo (`turbo.json`).
- Workspace packages are all under `packages/`:
  - `packages/api` (`@hexabot-ai/api`)
  - `packages/frontend` (`@hexabot-ai/frontend`)
  - `packages/widget` (`@hexabot-ai/widget`)
  - `packages/cli` (`@hexabot-ai/cli`)
  - `packages/graph` (`@hexabot-ai/graph`)
  - `packages/agentic` (`@hexabot-ai/agentic`)
  - `packages/types` (`@hexabot-ai/types`)
- Deployment/dev infra is under `docker/`.

## Environment prerequisites
- Node.js version: `^24.17.0` (required by the workspace).
- Package manager: PNPM via Corepack.
- Run commands from the repository root unless a package-level `AGENTS.md` says otherwise.

## Standard workspace commands
- Install dependencies: `pnpm install`
- Run all dev tasks: `pnpm dev`
- Build all packages: `pnpm build`
- Lint all packages: `pnpm lint`
- Run tests: `pnpm test`
- Typecheck all packages: `pnpm typecheck`
- Format all packages: `pnpm format`
- Clean all packages: `pnpm clean`

Use workspace filters for package-scoped work:
- `pnpm --filter <workspace-name> run <script>`
- Example: `pnpm --filter @hexabot-ai/api run test`

## Dependency management rules
- Use PNPM only. Do not use `npm install` or `yarn` for workspace changes.
- Add dependencies with filters from the root:
  - `pnpm add <pkg> --filter <workspace-name>`
  - `pnpm add -D <pkg> --filter <workspace-name>`
- Use `workspace:*` for internal package dependencies.
- Do not hand-edit lockfiles.

## Change guardrails
- Keep changes scoped to the task; avoid unrelated refactors.
- Do not edit generated artifacts directly (`dist/`, `coverage/`, build outputs).
- Preserve required license headers in source files where package lint rules enforce them.
- Follow existing package architecture and conventions instead of introducing parallel patterns.
- If behavior or contracts change, update relevant docs (`README.md`, package docs, or DSL docs) in the same change.

## Validation expectations
- At minimum, run checks for each touched workspace (`typecheck`, `lint`, `test`, and `build` when applicable).
- For cross-package or shared-contract changes, prefer running full workspace checks from root:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test`
  - `pnpm build`

## Release/versioning notes
- Root release helper: `bump-version.sh`.
- Do not run release/version bump scripts unless the task explicitly requests a release operation.
