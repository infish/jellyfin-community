FROM node:24.11.0-bookworm@sha256:e5bbac0e9b8a6e3b96a86a82bbbcf4c533a879694fd613ed616bae5116f6f243 AS build
RUN git config --global --add safe.directory /src
WORKDIR /src
COPY upstream/jellyfin-web/package.json upstream/jellyfin-web/package-lock.json upstream/jellyfin-web/.npmrc ./
RUN npm ci
COPY upstream/jellyfin-web/ ./
RUN npm run build:check && npm run build:production
# Include installed dependency sources as well as the modified web source.
# Export this stage for every distributed release, before publishing its images.
RUN mkdir /release && tar --exclude='./.git' --exclude='./dist' -czf /release/jellyfin-web-corresponding-source.tar.gz .

FROM scratch AS source
COPY --from=build /release/ /

FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d
LABEL org.opencontainers.image.source="https://github.com/infish/jellyfin-community" \
      org.opencontainers.image.licenses="GPL-2.0-or-later" \
      org.opencontainers.image.title="Jellyfin Community Web"
COPY --from=build /src/dist /srv/jellyfin-web
COPY --from=build /src/LICENSE /usr/share/licenses/jellyfin-web/LICENSE
COPY --from=build /src/node_modules/@jellyfin/libass-wasm/dist/js/COPYRIGHT /usr/share/licenses/subtitle-renderer/COPYRIGHT
COPY THIRD_PARTY_NOTICES.md /usr/share/licenses/jellyfin-community/THIRD_PARTY_NOTICES.md
COPY deploy/Caddyfile /etc/caddy/Caddyfile
