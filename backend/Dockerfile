FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY desktop/package.json desktop/package.json
RUN npm ci --workspace=@orbyn/backend --include-workspace-root=false
COPY backend backend
RUN npm run build -w backend
RUN npm prune --omit=dev --workspace=@orbyn/backend
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend ./backend
USER node
EXPOSE 8000
CMD ["node", "backend/dist/server.js"]
