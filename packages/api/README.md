# Hexabot API

[Hexabot](https://hexabot.ai/)'s API is a RESTful API built with NestJS, designed to handle requests from both the UI admin panel and various communication channels. The API powers core functionalities such as chatbot management, message flow, workflow execution, content management, analytics, and extension-driven actions.

## Key Features

- **REST + WebSocket API:** NestJS REST endpoints (prefixed with `/api`) plus Socket.IO for real-time events.
- **Extensible Channels/Actions/Helpers:** Dynamic providers load built-in and external extensions at runtime.
- **Workflow Engine:** Agentic workflows with runs, scheduling, and memory definitions.
- **Shared Output Contracts:** Runtime entity schemas and inferred types from `@hexabot-ai/types`.
- **Content & Localization:** CMS for content types/menus and i18n languages/translations.
- **Security & Auth:** Session-based auth, role/permission guard, CSRF protection, and JWT-backed flows (invite/reset/confirm).
- **Operational Tooling:** TypeORM migrations, auto-seeding in non-production when the DB is empty, and optional static UI hosting.

## API Modules

The API is divided into several key modules, each responsible for specific functionalities:

### Core Modules

- **Analytics:** Tracks bot stats and retention metrics.
- **Attachment:** Manages file uploads, downloads, and metadata.
- **Channel:** Webhook entrypoints and channel registry for external platforms.
- **Chat:** Messages, subscribers, and labels for inbox and conversation tracking.
- **CMS:** Content types, content entries, and menus.
- **Workflow:** Workflow definitions, runs, scheduling, memory definitions, and agentic execution.
- **Actions:** Registry for action extensions used by workflows.
- **Helper:** Registry for helper extensions such as storage and utility helpers.
- **I18n:** Languages, translations, and runtime localization.
- **User:** Authentication, roles, permissions, invitations, and password reset.
- **Settings:** Settings and metadata management.

### Platform Modules

- **WebSocket:** Socket.IO gateway with REST-style event dispatching.
- **Mailer:** SMTP + MJML templates for transactional emails.
- **Migration:** TypeORM migrations with CLI support and auto-migrate.
- **Database:** TypeORM configuration and session storage.
- **Logger:** Global logging utilities.
- **Extension:** Extension lifecycle and cleanup of extension settings.

### Extension System

- Built-in extensions live in `packages/api/src/extensions` (channels, actions, helpers).
- Additional extensions are discovered from `hexabot-channel-*`, `hexabot-action-*`, and `hexabot-helper-*` packages, plus compiled extensions in `dist/extensions`.
- Channel/helper runtime setting group keys and settings hook namespaces are now the extension `name` (kebab-case).
- Third-party channel/helper extensions must define settings groups and i18n namespaces with the same kebab-case extension `name`.

## Installation

```bash
$ pnpm install
```

## Configuration

Environment variables are loaded from `packages/api/.env` (see `packages/api/.env.example`).

- Default port is `3000` and the global API prefix is `/api`.
- SQLite is the default database (`./hexabot.sqlite`) and uses the `better-sqlite3` TypeORM driver; configure `DB_TYPE` and `DB_*` for Postgres.
- Set `REDIS_ENABLED=true` to use Redis-backed cache and the Socket.IO adapter.

## Development Commands

Run all commands from the repository root so PNPM can resolve workspace dependencies:

```bash
pnpm --filter @hexabot-ai/api run dev          # start the API with watch mode
pnpm --filter @hexabot-ai/api run start:debug  # run with inspector attached
pnpm --filter @hexabot-ai/api run build        # build API + frontend assets
pnpm --filter @hexabot-ai/api run start:prod   # run the compiled build
pnpm --filter @hexabot-ai/api run start:repl   # Nest REPL
```

### Testing

```bash
pnpm --filter @hexabot-ai/api run test      # unit tests
pnpm --filter @hexabot-ai/api run test:e2e  # end-to-end tests
pnpm --filter @hexabot-ai/api run test:cov  # collect coverage
```

### Quality

```bash
pnpm --filter @hexabot-ai/api run lint       # lint sources
pnpm --filter @hexabot-ai/api run typecheck  # type checking
```

## Migrations

Hexabot includes a migration module to help manage database schema and data changes over time. Migrations allow us to apply or revert changes to the database and keep it in sync with the version release.

Use the CLI for migration workflows (create, up, down):

```bash
pnpm --filter @hexabot-ai/api run cli migration create <version>
pnpm --filter @hexabot-ai/api run cli migration migrate up [version]
pnpm --filter @hexabot-ai/api run cli migration migrate down [version]
```

Auto-migration runs outside production by default, or in production when `DB_AUTO_MIGRATE=true` and `API_IS_PRIMARY_NODE=true`.

Check the Migration README file for more: [Migration Module](https://github.com/hexabot-ai/Hexabot/blob/main/packages/api/src/migration/README.md)

## Documentation

Access the Swagger API documentation by visiting `/docs` when running outside production.

It's also possible to access the API reference documentation by running `pnpm --filter @hexabot-ai/api run doc`.

All REST endpoints are prefixed with `/api`.

For detailed information about the API routes and usage, refer to the API documentation or visit [https://docs.hexabot.ai](https://docs.hexabot.ai).

## Contributing

We welcome contributions from the community! Whether you want to report a bug, suggest new features, or submit a pull request, your input is valuable to us.

Feel free to join us on [Discord](https://discord.gg/rNb9t2MFkG)

## License

Copyright (c) 2025 Hexastack.

This project is licensed under the **Fair Core License, Version 1.0**, with **Apache License 2.0** as the future license (abbrev. **FCL-1.0-ALv2**).

**Change date.** For each version of the software, the Fair Core License converts to Apache-2.0 on the **second anniversary** of the date that version is made available.

**Commercial features & license keys.** Certain features of Hexabot are protected by license-key checks. You **must not** remove, modify, disable, or circumvent those checks, nor enable access to protected functionality without a valid license key.

**Competing uses (non-compete).** Use that competes with Hexastack’s business—for example, offering Hexabot (or a substantially similar service) as a hosted or commercial product—is not permitted until the conversion to Apache-2.0 for the applicable version.

**Redistribution.** If you distribute copies, modifications, or derivatives, you must include this license and not remove copyright or proprietary notices.

**Patents.** A limited patent license is granted for permitted uses and terminates on patent aggression.

**Trademarks.** “Hexabot” and “Hexastack” are trademarks. Except to identify Hexastack as the origin of the software, no trademark rights are granted.

**Disclaimer.** The software is provided “AS IS,” without warranties or conditions of any kind, and Hexastack will not be liable for any damages arising from its use.
