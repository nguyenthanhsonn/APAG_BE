FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY scripts ./scripts
COPY prisma ./prisma
COPY assets ./assets
COPY src ./src

ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/smaste?schema=public"
ENV DIRECT_URL="postgresql://postgres:postgres@localhost:5432/smaste?schema=public"

RUN pnpm build

FROM base AS runner

ENV NODE_ENV="production"
ENV BACKEND_PORT="5050"

WORKDIR /app

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/.npmrc ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

EXPOSE 5050

CMD ["pnpm", "start:prod"]
