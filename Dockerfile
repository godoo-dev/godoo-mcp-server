# Build context contains only the tested npm tarball; no source recompilation.
FROM node:26.13.0-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9
WORKDIR /app
COPY package.tgz /candidate/package.tgz
RUN npm install --global --ignore-scripts --omit=dev --no-audit --no-fund /candidate/package.tgz \
    && rm -rf /candidate /root/.npm
USER node
ENV HOST=0.0.0.0 PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["godoo-mcp-server"]
