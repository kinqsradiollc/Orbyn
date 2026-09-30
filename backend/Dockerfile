# Builds the API / worker / migrate image from the monorepo root:
#   docker build -f backend/Dockerfile -t orbyn-backend .
# The same image runs every backend service (see compose.yaml):
#   node backend/dist/services/api.js       planner API (default)
#   node backend/dist/services/ai.js        AI assistant
#   node backend/dist/services/status.js    status probes and public report
#   node backend/dist/services/notifier.js  reminder delivery
#   node backend/dist/services/files.js     file store for imports
#   node backend/dist/services/converter.js turns imported files into pages
#   node backend/dist/migrate.js            apply SQL migrations
#   node backend/dist/server.js             everything in one process

# Workspace manifests only, so dependency layers cache independently of source.
FROM node:22-bookworm-slim AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY backend/package.json backend/package.json
COPY desktop/package.json desktop/package.json
COPY mobile/package.json mobile/package.json

# Compile shared packages and the backend with dev dependencies available.
FROM manifests AS build
RUN npm ci --workspace=@orbyn/core --workspace=@orbyn/api-client --workspace=@orbyn/backend --include-workspace-root=false
COPY packages/core packages/core
COPY packages/api-client packages/api-client
COPY backend backend
RUN npm run build -w @orbyn/core && npm run build -w @orbyn/api-client && npm run build -w @orbyn/backend

# Production dependencies only.
FROM manifests AS prod-deps
RUN npm ci --omit=dev --workspace=@orbyn/core --workspace=@orbyn/api-client --workspace=@orbyn/backend --include-workspace-root=false

FROM node:22-bookworm-slim
# Reading scanned pages and photos (the converter): Tesseract with English and
# page orientation, and poppler's pdftoppm to draw a PDF page as an image.
# About 60 MB; no model to download and nothing to turn on.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-osd \
    poppler-utils \
  && rm -rf /var/lib/apt/lists/*
# Set by scripts/deploy.sh; shown in Admin -> System and at /version.
ARG GIT_SHA=dev
ARG BUILD_TIME=
ENV NODE_ENV=production \
    APP_VERSION=$GIT_SHA \
    BUILD_TIME=$BUILD_TIME
LABEL org.opencontainers.image.revision=$GIT_SHA
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/core/package.json ./packages/core/package.json
COPY --from=build --chown=node:node /app/packages/core/dist ./packages/core/dist
COPY --from=build --chown=node:node /app/packages/api-client/package.json ./packages/api-client/package.json
COPY --from=build --chown=node:node /app/packages/api-client/dist ./packages/api-client/dist
COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/migrations ./backend/migrations
# Served at GET /openapi.yaml.
COPY --chown=node:node docs/openapi.yaml ./docs/openapi.yaml
# The file store's volume mounts here; owned by node so it can write.
RUN mkdir -p /data/files && chown node:node /data/files && chmod 700 /data/files
USER node
EXPOSE 8000
CMD ["node", "backend/dist/services/api.js"]
