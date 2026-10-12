FROM node:24.11.0-bookworm-slim@sha256:76d0ed0ed93bed4f4376211e9d8fddac4d8b3fbdb54cc45955696001a3c91152 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24.11.0-bookworm-slim@sha256:76d0ed0ed93bed4f4376211e9d8fddac4d8b3fbdb54cc45955696001a3c91152
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/infish/jellyfin-community" \
      org.opencontainers.image.licenses="GPL-2.0-or-later" \
      org.opencontainers.image.title="Jellyfin Community Backend"
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY LICENSE ./LICENSE
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3096
CMD ["node", "src/server.js"]
