FROM node:24-bookworm-slim

ARG APP_VERSION=unknown
ARG VCS_REF=unknown
ARG SOURCE_URL=ssh://git@git.lan/dev/home-web.git

LABEL org.opencontainers.image.title="home-web" \
  org.opencontainers.image.description="Self-hosted LAN dashboard" \
  org.opencontainers.image.version="$APP_VERSION" \
  org.opencontainers.image.revision="$VCS_REF" \
  org.opencontainers.image.source="$SOURCE_URL"

WORKDIR /app

COPY package.json package-lock.json ./
COPY src/ ./src/
COPY public/ ./public/

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "src/server.js"]
