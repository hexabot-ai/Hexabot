FROM node:24.22-alpine AS base

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable

RUN apk add --no-cache python3 make g++ linux-headers

WORKDIR /app

FROM base AS deps

WORKDIR /app

COPY package.json pnpm-workspace.yaml turbo.json pnpm-lock.yaml ./
COPY packages/api/package.json packages/api/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/widget/package.json packages/widget/package.json
COPY packages/agentic/package.json packages/agentic/package.json
COPY packages/graph/package.json packages/graph/package.json

RUN pnpm install --filter @hexabot-ai/api... --prod=false --network-concurrency 4

FROM deps AS build

COPY packages/api ./packages/api
COPY packages/types ./packages/types
COPY packages/frontend ./packages/frontend
COPY packages/widget ./packages/widget
COPY packages/agentic ./packages/agentic
COPY packages/graph ./packages/graph

RUN pnpm --filter @hexabot-ai/types run build
RUN pnpm --filter @hexabot-ai/agentic run build
RUN pnpm --filter @hexabot-ai/api run build

FROM base AS development

ENV NODE_ENV=development
# node_modules is baked into the image; don't let pnpm re-install on every script run
ENV pnpm_config_verify_deps_before_run=false

COPY package.json pnpm-workspace.yaml turbo.json pnpm-lock.yaml ./
COPY --from=deps /root/.cache/node/corepack /root/.cache/node/corepack
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY packages/api ./packages/api
COPY packages/agentic ./packages/agentic
COPY packages/types ./packages/types

EXPOSE 3000

CMD ["pnpm", "--filter", "@hexabot-ai/api", "run", "start:debug"]

FROM base AS production-deps

WORKDIR /app

COPY package.json pnpm-workspace.yaml turbo.json pnpm-lock.yaml ./
COPY packages/api/package.json packages/api/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/widget/package.json packages/widget/package.json
COPY packages/agentic/package.json packages/agentic/package.json
COPY packages/graph/package.json packages/graph/package.json

RUN pnpm install --filter @hexabot-ai/api... --prod --network-concurrency 4

FROM base AS production

ENV NODE_ENV=production

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/packages ./packages
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/types/dist ./packages/types/dist
COPY --from=build /app/packages/agentic/dist ./packages/agentic/dist
COPY packages/api/assets ./packages/api/assets
COPY packages/api/documentation ./packages/api/documentation

EXPOSE 3000

CMD ["node", "packages/api/dist/main"]
