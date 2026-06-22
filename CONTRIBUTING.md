# Contributing to Hexabot (v3)

Thanks for your interest in contributing.

This guide is for the current v3 development line.

## Branch and CI model

- `main` is the active v3 branch. Open pull requests against `main`.
- Pull requests targeting `main` trigger `.github/workflows/main-ci.yml`.
- The CI gate runs: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Security vulnerabilities

Do not open public GitHub issues for security vulnerabilities.

Report vulnerabilities privately to `hello@hexabot.ai` (see `SECURITY.md`) with:

- affected component/version,
- reproduction steps,
- impact,
- proposed mitigation (if available).

## Development prerequisites

- Node.js `^24.17.0`
- PNPM `9.12.0` (via Corepack)
- Git

From the repository root:

```bash
corepack enable pnpm@9.12.0
pnpm install
```

## Monorepo architecture

Hexabot uses a PNPM workspace monorepo orchestrated by Turborepo.

| Package | Responsibility |
| --- | --- |
| `@hexabot-ai/api` | NestJS backend, TypeORM entities/repositories/migrations, workflow runtime APIs |
| `@hexabot-ai/frontend` | React SPA admin app (Vite + React Router) |
| `@hexabot-ai/widget` | Embeddable live chat widget |
| `@hexabot-ai/agentic` | YAML DSL + typed workflow runtime |
| `@hexabot-ai/graph` | Reusable workflow graph editor/rendering package |
| `@hexabot-ai/types` | Shared Zod-first schemas/contracts |
| `@hexabot-ai/cli` | CLI for project bootstrap and operations |

## Package documentation

- [CLI](packages/cli/README.md)
- [API](packages/api/README.md)
- [Frontend](packages/frontend/README.md)
- [Agentic](packages/agentic/README.md)
- [Graph](packages/graph/README.md)
- [Types](packages/types/README.md)
- [Widget](packages/widget/README.md)

## Contribution workflow

1. Sync and branch from `main`.

```bash
git checkout main
git pull
git checkout -b feat/short-description
```

2. Make focused changes.
- Avoid unrelated refactors.
- Keep pull requests small and reviewable.
- Update docs when behavior or contracts change.

3. Run relevant checks locally.

Package-scoped checks (recommended while iterating):

```bash
pnpm --filter <workspace-name> typecheck
pnpm --filter <workspace-name> lint
pnpm --filter <workspace-name> test
pnpm --filter <workspace-name> build
```

Full v3 gate before opening/updating a PR:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

4. Commit using Conventional Commit style (commitlint is enforced).

Examples:
- `fix(api): handle null tool bindings in workflow parser`
- `feat(frontend): add workflow run timeline widget`
- `docs: update v3 contribution guide`

5. Open a pull request to `main`.
- Fill the PR template.
- Link related issues (for example: `Fixes #123`).
- Include test evidence and screenshots/logs when relevant.

## Reporting bugs and requesting features

- Bugs: open a GitHub bug issue with clear reproduction steps and logs.
- Features: open a feature request issue, or discuss early on Discord before large changes.
- Questions/support: use Discord: <https://discord.gg/rNb9t2MFkG>

## For Coding Agents (AI Contributors)

Read this section as an operational checklist.

1. Instruction precedence
- Read the closest `AGENTS.md` for every file you edit.
- Nearest `AGENTS.md` overrides broader instructions.
- For cross-package changes, follow root `AGENTS.md` plus each package-level `AGENTS.md`.

2. Package manager and dependency rules
- Use PNPM only for workspace work.
- Do not use `npm install` or `yarn` for monorepo dependency updates.
- Add dependencies from repo root with filters:
  - `pnpm add <pkg> --filter <workspace-name>`
  - `pnpm add -D <pkg> --filter <workspace-name>`
- Do not hand-edit `pnpm-lock.yaml`.

3. Change guardrails
- Keep diffs scoped to the task.
- Do not edit generated artifacts (`dist/`, `coverage/`, build output).
- Preserve required license headers in source files.
- Do not run release/version scripts unless explicitly requested.

4. Validation expectations
- Run `typecheck`, `lint`, `test`, and `build` for touched workspaces.
- For shared contracts or cross-package changes, run full workspace checks from root.

## License and contribution terms

This section is a contributor summary, not legal advice. Always consult license files directly.

### License map in this monorepo (v3/main)

Root workspace and all current workspace packages (`api`, `frontend`, `widget`, `graph`, `agentic`, `types`, `cli`) declare `FCL-1.0-ALv2`.

### FCL-1.0-ALv2 (summary)

For components under `FCL-1.0-ALv2`:
- Future license: Apache-2.0 becomes available per version on the second anniversary of that version's availability.
- License-key protections must not be removed, disabled, or circumvented.
- Competing use is restricted until the Apache-2.0 change date for that version.
- Redistribution must keep applicable notices and license terms.

### Source of truth

When there is any ambiguity, treat these as authoritative:
- `LICENSE.md`
- each package's `package.json` `license` field
- package-level notices/headers where applicable

By submitting a contribution, you agree that your changes are provided under the license terms applicable to the files/packages you modify.

## Community standards

- Follow our [Code of Conduct](./CODE_OF_CONDUCT.md).
- Be respectful in reviews and discussions.
- Prefer constructive, evidence-based feedback.

Thanks for contributing to Hexabot.
