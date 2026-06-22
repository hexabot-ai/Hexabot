# Agent Handbook - @hexabot-ai/frontend

Use this file as the entrypoint for AI coding agents working on the Hexabot admin panel frontend. It summarizes the runtime, data layer, and conventions so changes stay consistent with the existing architecture.

## Repository orientation
- Package root: `packages/frontend`
- App entry: `packages/frontend/src/main.tsx` (providers + global CSS imports)
- App shell: `packages/frontend/src/App.tsx`, `packages/frontend/src/layout/*`
- Routes: `packages/frontend/src/routes/routeConfig.tsx`
- Shared UI: `packages/frontend/src/app-components/*`
- Feature modules: `packages/frontend/src/components/*`
- Workflow editor integration: `packages/frontend/src/components/visual-editor/v4/*`
- Data layer: `packages/frontend/src/services/*`, `packages/frontend/src/hooks/crud/*`
- Types: `packages/frontend/src/types/*`
- i18n: `packages/frontend/src/i18n/config.ts`
- Websocket: `packages/frontend/src/websocket/*`
- Theme: `packages/frontend/src/layout/theme/index.ts`, `packages/frontend/src/layout/theme/AppTheme.tsx`

## Tooling and commands
- Node.js >= 24.17.0; PNPM workspace (run commands from repo root).
- Dev server: `pnpm --filter @hexabot-ai/frontend dev` (Vite on :8080).
- Build: `pnpm --filter @hexabot-ai/frontend build` (typecheck + Vite build).
- Typecheck: `pnpm --filter @hexabot-ai/frontend typecheck`.
- Lint: `pnpm --filter @hexabot-ai/frontend lint` (or `lint:fix` for fixes).
- Preview: `pnpm --filter @hexabot-ai/frontend preview`.
- Static rebuild (watch): `pnpm --filter @hexabot-ai/frontend dev:static`.

## Runtime architecture
- `main.tsx` composes providers in order: `BrowserRouter` -> `ConfigProvider` -> `AppTheme` -> `CssBaseline` -> `SnackbarProvider` -> `QueryClientProvider` -> `ApiClientProvider` -> `BroadcastChannelProvider` -> `AuthProvider` -> `PermissionProvider` -> `SettingsProvider` -> `DialogsProvider` -> `SocketProvider` -> `App` (with `ReactQueryDevtools` under the same `QueryClientProvider`).
- `App.tsx` resolves routes via `useRoutes(routes)` and passes `match.route.handle` into `Layout`.
- `Layout` swaps between `AnonymousLayout` and `AuthenticatedLayout`. Authenticated layout renders `DashboardHeader` + `DashboardSidebar` and gates route access with `requiredPermissions`.

## Routing + navigation
- Routes live in `packages/frontend/src/routes/routeConfig.tsx`; use `handle` for `isPublicRoute`, `requiredPermissions`, `hasNoPadding`, and `sxContent`.
- Use `useAppRouter` for navigation, params, and query parsing; it normalizes query params and supports `push`/`replace` helpers.
- Menu items are built from `packages/frontend/src/utils/menu.util.ts` and filtered by `useAvailableMenuItems` (permission-aware) before being passed to `DashboardSidebar`.

## Data layer / API
- `ApiClient` + `EntityApiClient` (`packages/frontend/src/services/api.class.ts`) centralize API calls and CSRF handling. Prefer these over raw axios.
- `useAxiosInstance` (`packages/frontend/src/hooks/useApiClient.ts`) sets `baseURL` from `ConfigProvider`, uses `withCredentials`, and intercepts 401/500 responses.
- CRUD hooks in `packages/frontend/src/hooks/crud/*` are the default data access pattern; they normalize responses with `normalizr` and cache via TanStack Query.
- Normalization schemas live in `packages/frontend/src/services/entities.ts` and convert date fields to `Date`.
- Query cache keys are standardized via `QueryType` and `EntityType` (`packages/frontend/src/services/types.ts`).
- API entity output contracts are maintained in `@hexabot-ai/types` (`packages/types`); keep frontend normalization and DTO assumptions aligned with those schemas.

## State, permissions, and auth
- `AuthProvider` loads the current user on boot and performs redirections for public routes.
- `PermissionProvider` loads permissions; `useHasPermission` and `requiredPermissions` gate UI and routes.
- BroadcastChannel is used for cross-tab login/logout events (`BroadcastChannelProvider` + `useSubscribeBroadcastChannel`).

## UI + styling
- UI stack: React 18, MUI v7 + Emotion, React Router, TanStack Query, React Hook Form.
- MUI theme customization is centralized in `packages/frontend/src/layout/theme` and injected via `AppTheme`.
- Global styles live in `packages/frontend/src/styles/globals.css` plus feature-specific CSS imports in `main.tsx`.
- Shared components live under `packages/frontend/src/app-components/*`; feature/page components live under `packages/frontend/src/components/*`.
- MUI DataGrid usage is wrapped by `useDataGridProps` + `useSearch` + `usePagination` for common list screens.
- The visual editor imports `@hexabot-ai/graph` for graph rendering/layout and keeps YAML editor/forms/workflow orchestration in `packages/frontend/src/components/visual-editor/v4`.

## Workflow graph package boundary
- `@hexabot-ai/graph` owns graph building/decorating/projecting/layout logic and xyflow rendering primitives.
- Frontend owns workflow editor routing, graph callbacks, workflow persistence, and URL/selection synchronization.
- Main integration points: `packages/frontend/src/components/visual-editor/v4/layouts/Workflow.tsx`, `packages/frontend/src/components/visual-editor/v4/providers/WorkflowProvider.tsx`, and `packages/frontend/src/main.tsx` (graph stylesheet import).
- If you need to change graph internals (nodes/edges/layout/selection helpers), update `packages/graph/*` rather than re-implementing logic in frontend.

## i18n
- i18next is configured in `packages/frontend/src/i18n/config.ts` with backend loading from `/locales/{{lng}}/{{ns}}.json`.
- Use `useTranslate` or `react-i18next` hooks for translations; settings provider loads remote i18n (`useRemoteI18n`).

## WebSockets
- Socket integration is in `packages/frontend/src/websocket/*`; use `SocketProvider`, `useSubscribe`, or `useSocketGetQuery`.
- `AuthenticatedLayout` boots message/subscriber socket subscriptions.

## Environment + config
- `ConfigProvider` reads `VITE_API_ORIGIN`, `VITE_SSO_ENABLED`, and `VITE_UPLOAD_MAX_SIZE_IN_BYTES`; it fetches `/config` at runtime and shows `Progress` while loading.
- `runtimeConfig` uses `VITE_DEFAULT_LANGUAGE` for i18n defaults.
- Vite dev server proxies `/api` and `/socket.io` to `http://localhost:3000` (`packages/frontend/vite.config.mts`).

## Conventions and gotchas
- Path alias: `@/` maps to `packages/frontend/src` (TS + Vite).
- New TS/TSX files must include the license header; ESLint `header/header` enforces it.
- Avoid `console.*`; ESLint forbids it.
- Use `Format.FULL` + `POPULATE_BY_TYPE` when you need nested relations; do not hand-roll populate params.
- Chat rendering contract: branch by discriminators from `@hexabot-ai/types`.
- When adding a new entity type, update: `packages/frontend/src/services/types.ts`, `packages/frontend/src/services/entities.ts`, and `packages/frontend/src/types/base.types.ts`.
- When adding a new route, update `packages/frontend/src/routes/routeConfig.tsx` and (if needed) menu configuration in `packages/frontend/src/utils/menu.util.ts`.
