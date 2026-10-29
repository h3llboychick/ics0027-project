FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# corepack enable command allows to use pnpm/yarn without installing them
# corepack will use the package manager specified in package.json packageManager
# more about corepack here: https://www.npmjs.com/package/corepack
RUN corepack enable 

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
ARG NEXT_PUBLIC_FILE_OPERATION_POLL_MS=2000
ENV NEXT_PUBLIC_FILE_OPERATION_POLL_MS=$NEXT_PUBLIC_FILE_OPERATION_POLL_MS
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next.js evaluates the auth route while building. Prisma needs a URL to be
# constructed, but the production build does not connect to the database.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
ENV BETTER_AUTH_SECRET="build-only-secret-not-used-at-runtime-1234567890"
ENV BETTER_AUTH_URL="http://localhost:3000"
RUN pnpm exec prisma generate && mkdir -p public && pnpm build && pnpm build:worker

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/dist/worker ./dist/worker
RUN mkdir -p /app/storage \
    && chown node:node /app/storage

USER node
EXPOSE 3000
CMD ["node", "server.js"]
