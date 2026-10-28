FROM node:26.12.0-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5 AS base
WORKDIR /app
# Node 25+ no longer bundles corepack.
RUN npm install --global pnpm@11.28.6
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM base AS deps
RUN pnpm install --frozen-lockfile --prod

FROM node:26.12.0-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
# Loop mode only; `once` always reports healthy. Docker only reports the status; compose does not restart an unhealthy container.
HEALTHCHECK --interval=60s --timeout=10s --start-period=60s --retries=3 CMD ["node", "dist/bin/healthcheck.js"]
CMD ["node", "dist/index.js"]
