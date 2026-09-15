# Builds the static web app behind nginx from the monorepo root:
#   docker build -f desktop/Dockerfile -t orbyn-web .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY backend/package.json backend/package.json
COPY desktop/package.json desktop/package.json
COPY mobile/package.json mobile/package.json
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci --workspace=@orbyn/core --workspace=@orbyn/api-client --workspace=@orbyn/desktop --include-workspace-root=false
COPY packages packages
COPY desktop desktop
# The web app knows its version, so it can offer a reload after a deploy.
ARG GIT_SHA=dev
ENV VITE_APP_VERSION=$GIT_SHA
RUN npm run build -w @orbyn/core && npm run build -w @orbyn/api-client && npm run build -w @orbyn/desktop

FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY desktop/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/desktop/dist /usr/share/nginx/html
EXPOSE 8080
