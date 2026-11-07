# Builds orbyn.dev and serves it with nginx as an unprivileged user.
FROM node:22-alpine AS build
ARG GIT_SHA=dev
WORKDIR /src
COPY scripts/build-site.mjs scripts/
COPY site site
# _headers is for Cloudflare Workers; nginx.conf sends the same headers.
RUN node scripts/build-site.mjs && rm dist/_headers && echo "$GIT_SHA" > dist/version.txt

FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /src/dist /usr/share/nginx/html
