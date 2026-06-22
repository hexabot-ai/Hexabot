FROM node:24.17-alpine AS base

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-workspace.yaml turbo.json pnpm-lock.yaml .npmrc ./
COPY packages/api/package.json packages/api/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/widget/package.json packages/widget/package.json

RUN pnpm install --filter @hexabot-ai/frontend... --prod=false

FROM deps AS builder

COPY packages/frontend ./packages/frontend
COPY packages/widget ./packages/widget

RUN pnpm --filter @hexabot-ai/frontend... run build

FROM base AS development

ENV NODE_ENV=development

COPY --from=deps /app/node_modules ./node_modules
COPY packages/frontend ./packages/frontend
COPY packages/widget ./packages/widget

WORKDIR /app/packages/frontend
EXPOSE 8080

CMD ["pnpm", "--filter", "@hexabot-ai/frontend", "run", "dev", "--", "--host", "0.0.0.0", "--port", "8080"]

FROM nginx:1.27-alpine AS production

COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html
COPY packages/frontend/public /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
