# syntax=docker/dockerfile:1
#
# bibtrack in a container. There is no build step for the server: tsx is a runtime
# dependency and tsconfig.json is noEmit, so the image ships the TypeScript sources
# and runs them. Only the web UI is built, because web/dist is gitignored.
#
# Set BIBTRACK_DIR's mount, HOST and BIBTRACK_ORIGIN from compose; the server binds
# loopback and rejects foreign origins unless told otherwise.

# ---- build the web UI ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY tsconfig.json ./
COPY shared ./shared
# web/src/bookmarklet.ts imports ../../extension/capture.js, so extension/ is part of
# the Vite build graph even though the add-on itself is not shipped in the image.
COPY extension ./extension
COPY web ./web
RUN npm run build

# ---- production dependency tree ----
FROM node:22-bookworm-slim AS deps
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=5577 \
    HOST=0.0.0.0 \
    BIBTRACK_DIR=/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY shared ./shared
COPY server ./server
# server/index.ts resolves web/dist relative to its own location, so keep this layout.
COPY --from=build /app/web/dist ./web/dist
EXPOSE 5577
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5577)+'/api/info').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# tsx directly rather than `npm start`, so PID 1 is node and docker stop exits promptly.
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/index.ts"]
