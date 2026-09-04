FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATABASE_PATH=/app/data/wol.db
EXPOSE 3000
CMD ["node", "src/server.js"]
