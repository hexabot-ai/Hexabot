# Project Overview
`@hexabot-ai/widget` is the embeddable live chat widget for Hexabot. It is a React + TypeScript package bundled with Vite as a library (`dist/hexabot-widget.umd.js` + `dist/style.css`), intended to be dropped into external websites.

Typical agent work in this package includes:
- Updating chat UI components and styles.
- Extending message rendering/types.
- Adjusting provider logic (config, socket, settings, translation, widget state).
- Maintaining the token-based theme system (`ThemeProvider`, CSS vars, light/dark palettes).
- Maintaining build/lint/typecheck configuration.
- Preparing package-level release/version changes.

## Repository Structure
Key paths in `packages/widget`:
- `src/ChatWidget.tsx`: Main exported widget entry (also Vite library entry).
- `src/UiChatWidget.tsx`: Alternate/customizable widget composition entry.
- `src/main.tsx`: Local dev/demo app entry for Vite.
- `src/components/`: UI building blocks (chat window, header, messages, launcher, buttons, icons).
- `src/providers/`: Context/state providers (`ConfigProvider`, `SocketProvider`, `ChatProvider`, `ThemeProvider`, etc.).
- `src/hooks/`: Reusable hooks (`useTranslation`, socket/broadcast hooks).
- `src/theme/`: Theme contracts, resolver logic, and CSS variable defaults.
- `src/test/`: Test setup files (Vitest/jsdom).
- `src/types/`: Core TS models (`config.types.ts`, `message.types.ts`, `state.types.ts`, etc.).
- `src/constants/`: Default config, color palettes, emoji data.
- `src/translations/`: Localized strings (`en`, `fr`).
- `src/utils/`: Utilities (socket client, storage helpers, file/text helpers).
- `public/`: Static files used by local/demo hosting (`public/index.html` includes a UMD embed example).
- `dist/`: Generated build artifacts. Do not edit manually.
- `package.json`: Scripts, dependencies, package metadata.
- `eslint.config.cjs` / `eslint.config-staged.cjs`: Lint rules.
- `.prettierrc`: Formatting defaults.
- `tsconfig*.json`: TypeScript config.
- `vite.config.ts`: Library bundling and externals config.
- `Dockerfile`: Containerized build/dev/serve flow.

## Setup & Dev Environment
Prerequisites:
- Node.js `^24.17.0` (see `engines`).
- PNPM workspace (`pnpm@9.12.0` at repo root).

Recommended setup from repo root:
```bash
pnpm install --frozen-lockfile
pnpm --filter @hexabot-ai/widget run dev
```

Alternative (inside package):
```bash
cd packages/widget
pnpm run dev
```

Local dev server runs on Vite default port `5173`.

## Build, Test & Run Commands
Run from repo root:
```bash
# Build distributable bundle
pnpm --filter @hexabot-ai/widget run build

# Type safety
pnpm --filter @hexabot-ai/widget run typecheck

# Lint
pnpm --filter @hexabot-ai/widget run lint
pnpm --filter @hexabot-ai/widget run lint:fix

# Unit tests
pnpm --filter @hexabot-ai/widget run test

# Preview / static serve
pnpm --filter @hexabot-ai/widget run preview
pnpm --filter @hexabot-ai/widget run serve

# Clean generated build
pnpm --filter @hexabot-ai/widget run clean
```

Critical local gate before PR:
```bash
pnpm --filter @hexabot-ai/widget run typecheck && \
pnpm --filter @hexabot-ai/widget run lint && \
pnpm --filter @hexabot-ai/widget run test && \
pnpm --filter @hexabot-ai/widget run build
```

Unit tests:
- Vitest is configured in `vite.config.ts` under `test`.
- Current widget tests live in:
  - `src/theme/theme.utils.test.ts`
  - `src/providers/ThemeProvider.test.tsx`
- Test setup is initialized in `src/test/setup.ts`.

## Coding Style & Conventions
- Language/tooling: TypeScript + React function components + hooks.
- Formatting (`.prettierrc`):
  - Double quotes (`singleQuote: false`).
  - Trailing commas enabled (`trailingComma: "all"`).
- TypeScript strictness (`tsconfig.app.json`): `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`.
- ESLint highlights (`eslint.config.cjs`):
  - Keep import order grouped and alphabetized.
  - No duplicate imports.
  - `no-console` is enforced (existing exceptions are explicitly lint-disabled in code).
  - Unused vars must be removed unless intentionally prefixed with `_`.
  - React hooks rules are enabled with selected relaxations already configured.
- License header is required in TS/TSX/JS/JSX files. Preserve/add this block:
```ts
/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 20XX Hexastack.
 * Full terms: see LICENSE.md.
 */
```
- Naming patterns used in this package:
  - Components/providers: `PascalCase` files (e.g., `ChatWindow.tsx`).
  - Hooks: `useXxx` (e.g., `useTranslation.tsx`).
  - Types: `*.types.ts`.
  - Co-located styles: `ComponentName.scss` next to the component.

## Testing Strategy
Current state:
- This package includes a Vitest + jsdom setup for widget-level unit tests.
- CI on `main` runs workspace checks (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` via Turbo). For widget-specific quality, treat `typecheck + lint + test + build` as the effective gate.
- Git hooks (`.husky/pre-commit`) run widget checks when widget files are staged: `pnpm typecheck` + `npx lint-staged` from `packages/widget`.

Recommended local validation:
1. Run `typecheck`, `lint`, `test`, and `build`.
2. Run `dev` and verify core chat flows manually (connect, receive/send messages, pre-chat form, launcher open/close).
3. Smoke-check UMD embed via `public/index.html` or `dist` preview.

> TODO: Define coverage thresholds and CI enforcement for this package.

## Common Tasks & Workflows
Add a new message type:
1. Extend message type definitions in `src/types/message.types.ts`.
2. Add renderer component under `src/components/messages/` with matching `.scss`.
3. Register rendering branch in `src/components/Message.tsx`.
4. If needed, adjust message preprocessing/state behavior in `src/providers/ChatProvider.tsx`.
5. Run `typecheck`, `lint`, and `build`.

Add/modify translations:
1. Update `src/translations/en/translation.json` and `src/translations/fr/translation.json`.
2. Access keys via `useTranslation` (`src/hooks/useTranslation.tsx`).
3. Keep translation key parity across languages.

Update widget config defaults:
1. Update `src/types/config.types.ts` (contract) and `src/constants/defaultConfig.ts` (defaults).
2. Verify propagation through `src/providers/ConfigProvider.tsx`.
3. Validate local demo behavior in `src/main.tsx`.

Update widget theming:
1. Update contracts in `src/theme/theme.types.ts` and resolver behavior in `src/theme/theme.utils.ts`.
2. Keep priority and compatibility behavior aligned:
   - config override > server settings > system prefers-color-scheme > safe defaults
   - support both `theme` and legacy `theme_color` / `themeColor`
3. Keep `useTheme()` for TS logic and CSS custom properties on `.sc-theme-root` for styles.
4. Preserve `useColors()` compatibility exports for existing components/integrations.

Update dependencies:
```bash
# Example (runtime dependency)
pnpm add <package> --filter @hexabot-ai/widget

# Example (dev dependency)
pnpm add -D <package> --filter @hexabot-ai/widget
```
Then run:
```bash
pnpm --filter @hexabot-ai/widget run typecheck
pnpm --filter @hexabot-ai/widget run lint
pnpm --filter @hexabot-ai/widget run build
```

Release (v3 alpha train, `main` branch):
```bash
./bump-version.sh preminor
```
> TODO: Confirm with maintainers whether a given release should use `prepatch`, `preminor`, or `prerelease`.

## Guardrails & Agent Instructions
- Do not hand-edit generated or vendored paths:
  - `packages/widget/dist/**`
  - `packages/widget/node_modules/**`
  - `packages/widget/.turbo/**`
- Keep the public widget entry contract stable unless explicitly requested:
  - `src/ChatWidget.tsx` default export.
  - Vite library build target in `vite.config.ts` (`name: "HexabotWidget"`).
- Keep theme backward compatibility unless explicitly requested otherwise:
  - `theme_color` / `themeColor` support must remain functional.
  - `src/providers/ColorProvider.tsx` currently re-exports theme-backed compatibility hooks.
- Settings persistence is now instance-scoped (`hexabot:widget:settings:<scope>`); avoid changes that re-introduce cross-widget leakage.
- Any protocol-level changes (socket payloads, webhook behavior) must stay compatible with the backend expectations used in `src/providers/ChatProvider.tsx` and `src/utils/SocketIoClient.ts`.
- Preserve license headers and do not remove licensing notices.
- Avoid unrelated monorepo edits when the task is widget-scoped.
- Code ownership:
  > TODO: No `CODEOWNERS` file found in this repository; confirm reviewer/approver group with maintainers.
