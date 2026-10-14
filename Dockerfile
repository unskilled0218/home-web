FROM node:24-bookworm-slim

ARG APP_VERSION=unknown
ARG VCS_REF=unknown
ARG SOURCE_URL=ssh://git@git.lan/dev/home-web.git

LABEL org.opencontainers.image.title="home-web" \
  org.opencontainers.image.description="Self-hosted LAN dashboard" \
  org.opencontainers.image.version="$APP_VERSION" \
  org.opencontainers.image.revision="$VCS_REF" \
  org.opencontainers.image.source="$SOURCE_URL"

RUN mkdir -p /app/data

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src/ ./src/
COPY public/ ./public/

EXPOSE 3000

CMD ["node", "src/server.js"]
