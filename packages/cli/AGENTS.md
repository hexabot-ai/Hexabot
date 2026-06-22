# Hexabot CLI

This file is the authoritative cheat-sheet for the Hexabot CLI. It summarizes the runtime bootstrap, core helpers, and per-command responsibilities so we can confidently extend or coordinate agent work without re-reading the entire codebase.

## Runtime & Bootstrap

- **Entry point**: `src/index.ts` prints the banner (`printBanner()`) and calls `checkPrerequisites({ silent: true })` before instantiating the Commander program. That pre-flight verifies Node.js (see below) so user-facing commands can assume a supported runtime.
- **CLI factory**: `createCliProgram()` (`src/cli.ts`) builds the `Command` instance, configures name/description/version (`getCliVersion()`), and registers `check`, `create`, `config`, `dev`, `docker`, `env`, `start`, and `migrate` commands.
- **Prerequisite gate**: `checkPrerequisites()` / `checkNodeVersion()` / `checkDocker()` (`src/core/prerequisites.ts`) centralize system checks. The top-level bootstrap validates Node (>= 24.17.0) while Docker checks are performed by commands that actually need Docker.
- **Project guard**: `assertHexabotProject()` / `isHexabotProject()` (`src/core/project.ts`) enforce that commands run inside a workspace whose `package.json` depends on `@hexabot-ai/api`. Docker-aware commands also call `ensureDockerFolder()` which ensures `<projectRoot>/docker/` exists before touching compose files.
- **Service parsing**: `parseServices()` (`src/utils/services.ts`) normalizes the shared `--services` flag to a de-duped string array so Docker helpers can safely compose per-service overlays.

## Configuration & Environment Model

- **Config file**: `hexabot.config.json` lives at the project root and is managed by `src/core/config.ts`. `loadProjectConfig()` merges user overrides with defaults (`devScript`, `startScript`, compose path `docker/docker-compose.yml`, env filenames, and optional `packageManager`). `ensureProjectConfig()` writes the file when scaffolding and `updateProjectConfig()` persists dot-notation updates from the CLI.
- **Env helpers**: `bootstrapEnvFile()`, `listEnvStatus()`, and `resolveEnvExample()` (`src/core/env.ts`) copy `*.example` files when needed and report which env files exist. Commands never manipulate env paths directly—they rely on the config struct.
- **Package managers**: `normalizePackageManager()`, `detectPackageManager()`, `runPackageScript()`, and `installDependencies()` (`src/core/package-manager.ts`) keep npm/pnpm/yarn/bun handling consistent. `runPackageScript()` verifies the requested script exists in `package.json` before executing it.

## Docker Compose helpers

- **Compose resolution**: `resolveComposeFile()` ensures config paths are absolute, `resolveComposeEnvFile()` returns an existing Docker env file for Compose `--env-file`, and `generateComposeFiles()` (`src/core/docker.ts`) builds the `-f` flag chain. It always starts with the base file, then per-service overlays (`docker-compose.<service>.yml`), optional service/mode overlays (`docker-compose.<service>.<dev|prod>.yml`), and finally the global `docker-compose.<mode>.yml` when it exists.
- **Execution wrappers**: `dockerCompose()` and `dockerExec()` (same module) print highlighted commands, run them via `execSync`, and exit with code `1` on Docker failures. Docker-mode commands pass `.env.docker` through `dockerCompose(..., { envFile })` when it exists so Compose-level interpolation uses the Docker env values.

## Subcommand Catalog

| Command | Responsibilities | Options & IO | Implementation Notes |
| --- | --- | --- | --- |
| `check [--docker-only] [--no-docker]` | Run diagnostics for local Node version, Hexabot project detection, env files, and optionally Docker. | Flags narrow which checks run; outputs PASS/FAIL rows and sets exit code 1 if any check fails. | `src/commands/check.ts` calls `checkNodeVersion()`, `isHexabotProject()`, `loadProjectConfig()`, `listEnvStatus()`, and `checkDocker()` in sequence and prints results with chalk. |
| `create <projectName>` | Scaffold a project from a GitHub template, configure package manager, bootstrap env files, install deps, and optionally start dev mode. | `--template`, `--pm`, `--no-install`, `--dev`, `--docker`, `--force`. Writes `hexabot.config.json`, bootstraps local and Docker env files, persists initial admin seed credentials, sets `COMPOSE_PROJECT_NAME` in `.env.docker`, installs deps (unless skipped), and can immediately run `hexabot dev`. Post-create output should clearly present `hexabot dev` as local SQLite mode and `hexabot dev --docker --services postgres` as Docker plus Postgres mode. | `src/commands/create.ts` validates the slug, downloads the latest release zip of `hexastack/hexabot-template-*` via `downloadAndExtractTemplate()`, ensures config/env files exist, installs dependencies via `installDependencies()`, and optionally calls `runDev()` for the new project. |
| `config show` | Print the effective `hexabot.config.json` after merging defaults. | No flags; emits pretty-printed JSON. | `src/commands/config.ts` resolves the project root, asserts the workspace, and calls `loadProjectConfig()`. |
| `config set <key> <value>` | Update nested config values via dot notation with type-aware parsing. | Supports booleans, numbers, JSON literals, comma lists (for `*Services` keys), and package-manager normalization. | Uses `parseValue()` + `buildOverride()` to construct overrides, writes via `updateProjectConfig()`, and echoes the new config. |
| `dev [--docker] [--services] [-d] [--env] [--no-env-bootstrap] [--pm]` | Run the project in development mode using either the package script or Docker compose stack. | When not using Docker it runs the configured dev script (`dev` default) after optional env bootstrapping. Docker mode bootstraps the docker env file, resolves compose overlays, and runs `docker compose --env-file .env.docker ... up --build [-d]` when the Docker env exists. | `src/commands/dev.ts` auto-detects the package manager, persists it into the config, handles env bootstrapping (local or docker), then either calls `runPackageScript()` or `runDockerDev()` (which uses `generateComposeFiles()` with mode `dev`). |
| `start [--docker] [--services] [-d] [--build] [--env] [--env-bootstrap] [--pm]` | Production entry point mirroring `dev` but defaulting to the configured start script and prod compose overlays. | Local mode optionally bootstraps env files when `--env-bootstrap` is passed; Docker mode layers prod compose files, supports `--build`/`--detach`, passes `.env.docker` to Compose when present, and logs which services start. | `src/commands/start.ts` shares the package-manager persistence logic with `dev`. `runDockerStart()` enforces Docker availability, resolves compose overlays with mode `prod`, and shells out via `dockerCompose()`. |
| ``docker up`` / ``docker down`` | Low-level Docker helpers for dev-mode compose stacks. | `up` supports `--services`, `--build`, `--detach`; `down` supports `--services` and `--volumes`. Both pass `.env.docker` to Compose when present. | `src/commands/docker.ts` ensures config + docker folder, resolves services (`parseServices()` with fallbacks to `config.docker.defaultServices`), bootstraps docker env files for `up`, and executes `docker compose ... up|down`. |
| ``docker logs [service]`` / ``docker ps`` | Introspection helpers for the dev stack. | Logs accept `--follow`/`--since`. | Reuse `generateComposeFiles(..., 'dev')` plus targeted docker compose commands. |
| ``docker start`` | Production-mode convenience wrapper for `hexabot start --docker`. | `--services`, `--detach`, `--build`, `--env-bootstrap`. | This subcommand simply calls `runStart({ docker: true, ... })` so behavior stays aligned with the main `start` command. |
| `env init [--docker] [--force]` | Copy the configured `.env*` files from their `.example` counterparts. | By default bootstraps the local env; `--docker` switches to docker env paths; `--force` overwrites. | `src/commands/env.ts` calls `bootstrapEnvFile()` with the paths from the loaded config. |
| `env list` | Show which env files exist. | None; prints ✓/✗ markers. | Uses `listEnvStatus()` results and chalk formatting. |
| `migrate [args...]` | Execute database migrations inside the `api` container. | Arbitrary args are appended to `npm run migrate`. Requires a dockerized project root. | `src/commands/migrate.ts` checks Docker, ensures `docker/` exists, and runs `dockerExec('api', 'npm run migrate …', '--user $(id -u):$(id -g)')` so generated files share the host UID/GID. |

## Shared Utilities & Services

- **Template download**: `downloadAndExtractTemplate()` (`src/services/templates.ts`) fetches the release archive with `fetch`, saves it as `template.zip`, extracts using `decompress` (`strip: 1`), and then deletes the zip. `create` is the only consumer.
- **Project metadata**: `readPackageJson()` (`src/core/project.ts`) powers package-manager validation and Hexabot project detection.
- **Versioning**: `getCliVersion()` (`src/utils/version.ts`) reads `packages/cli/package.json` and defaults to `3.0.0` on failure.

## Typical Workflow

1. `hexabot create my-bot` — scaffold a workspace, persist the preferred package manager into `hexabot.config.json`, bootstrap both local and Docker env files, set the Docker Compose project name, capture initial admin credentials, and install dependencies.
2. `cd my-bot`
3. `hexabot check` — confirm Node/Docker availability, project structure, and env files before running heavier commands.
4. `hexabot env init` — re-run if you need to refresh `.env` files (use `--docker` to target docker envs).
5. `hexabot dev` — run local dev with SQLite.
6. `hexabot dev --docker --services postgres` — run dev with Docker and Postgres when needed.
7. `hexabot start` or `hexabot start --docker --services api` — run production scripts locally or via Docker.
8. `hexabot docker down --volumes` / `hexabot migrate` / `hexabot env list` as needed for lifecycle management.

## Extending the CLI

- Follow the established pattern under `src/commands/` by implementing `registerFooCommand(program: Command)` modules and wiring them up inside `createCliProgram()` so help/version wiring stays centralized.
- Always gate project-specific commands with `assertHexabotProject()`, and guard docker-aware flows with both `checkDocker()` and `ensureDockerFolder()`.
- Use `loadProjectConfig()` / `updateProjectConfig()` instead of hard-coding script names, env files, or compose paths. That keeps future overrides working automatically.
- Share env initialization via `bootstrapEnvFile()` / `listEnvStatus()` and `--force` semantics rather than reimplementing file copies.
- When adding compose-aware commands, rely on `parseServices()` and `generateComposeFiles()` so service overlays, dev/prod modes, and future compose conventions stay consistent.
- Keep this AGENTS.md file updated whenever commands, defaults, or orchestrating helpers change so downstream automation never acts on stale assumptions.
