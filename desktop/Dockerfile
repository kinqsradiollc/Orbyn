FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY desktop/package.json desktop/package.json
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci --workspace=@orbyn/desktop --include-workspace-root=false
COPY desktop desktop
RUN npm run build -w desktop
FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY desktop/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/desktop/dist /usr/share/nginx/html
EXPOSE 8080
