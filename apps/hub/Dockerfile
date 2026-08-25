FROM node:22.22.0-bookworm-slim AS build

WORKDIR /app

RUN corepack enable \
  && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/hub/package.json ./apps/hub/package.json
RUN pnpm install --frozen-lockfile --filter @dsh-easyremote/hub...

COPY apps/hub/tsconfig.json ./apps/hub/tsconfig.json
COPY apps/hub/src ./apps/hub/src
RUN pnpm --filter @dsh-easyremote/hub build
RUN pnpm install --frozen-lockfile --offline --prod --filter @dsh-easyremote/hub...

FROM node:22.22.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/data \
  && chown -R node:node /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/hub/node_modules ./apps/hub/node_modules
COPY --from=build /app/apps/hub/package.json ./apps/hub/package.json
COPY --from=build /app/apps/hub/dist ./apps/hub/dist

USER node
EXPOSE 8787
CMD ["node", "apps/hub/dist/index.js"]
