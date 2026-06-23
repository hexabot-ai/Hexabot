FROM node:24.17-alpine AS base

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

RUN pnpm install --filter @hexabot-ai/api... --prod=false --network-concurrency 4

FROM deps AS build

COPY packages/api ./packages/api
COPY packages/types ./packages/types
COPY packages/frontend ./packages/frontend
COPY packages/widget ./packages/widget

RUN pnpm --filter @hexabot-ai/types run build
RUN pnpm --filter @hexabot-ai/api run build

FROM base AS development

ENV NODE_ENV=development

COPY package.json pnpm-workspace.yaml turbo.json pnpm-lock.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY packages/api ./packages/api
COPY packages/agentic ./packages/agentic
COPY packages/types ./packages/types
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/widget/package.json packages/widget/package.json

EXPOSE 3000

CMD ["pnpm", "--filter", "@hexabot-ai/api", "run", "start:debug"]

FROM base AS production-deps

WORKDIR /app

COPY package.json pnpm-workspace.yaml turbo.json pnpm-lock.yaml ./
COPY packages/api/package.json packages/api/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/widget/package.json packages/widget/package.json

RUN pnpm install --filter @hexabot-ai/api... --prod --network-concurrency 4

FROM base AS production

ENV NODE_ENV=production

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY packages/api/package.json ./packages/api/package.json
COPY packages/api/assets ./packages/api/assets
COPY packages/api/documentation ./packages/api/documentation

EXPOSE 3000

CMD ["node", "packages/api/dist/main"]
