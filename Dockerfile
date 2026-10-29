# syntax=docker/dockerfile:1.7
# M&N FieldOps images. Targets: web (Next.js standalone server) and worker
# (pg-boss consumer with Chromium for PDF rendering and Python for extraction).
# Secrets are never baked in; they come from the runtime environment.
# Behind a TLS-intercepting proxy, pass its CA as an optional build secret:
#   docker build --secret id=build_ca,src=/path/to/ca.pem ...

ARG NODE_IMAGE=node:22.22.0-bookworm-slim
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.63.0-noble
ARG PNPM_VERSION=10.28.0

FROM ${NODE_IMAGE} AS deps
ARG PNPM_VERSION
WORKDIR /app
RUN --mount=type=secret,id=build_ca,required=false \
  if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
  npm install -g pnpm@${PNPM_VERSION}
COPY package.json pnpm-lock.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=secret,id=build_ca,required=false \
  if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
  pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM ${NODE_IMAGE} AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system --gid 1001 fieldops && useradd --system --uid 1001 --gid fieldops --home /app fieldops \
  && mkdir -p /data/storage && chown fieldops:fieldops /data/storage
COPY --from=build --chown=fieldops:fieldops /app/.next/standalone ./
COPY --from=build --chown=fieldops:fieldops /app/.next/static ./.next/static
USER fieldops
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

FROM ${PLAYWRIGHT_IMAGE} AS worker
ARG PNPM_VERSION
WORKDIR /app
ENV NODE_ENV=production PYTHON_BIN=/opt/pdf/bin/python WORKER_HEALTH_PORT=3100
# Optional: APT_MIRROR=https://archive.ubuntu.com/ubuntu/ where plain-HTTP mirrors are blocked.
ARG APT_MIRROR=
RUN --mount=type=secret,id=build_ca,required=false \
  if [ -n "$APT_MIRROR" ]; then sed -i -E "s#http://([a-z]+\.)?(archive|security)\.ubuntu\.com/ubuntu/#${APT_MIRROR}#" /etc/apt/sources.list.d/ubuntu.sources; fi; \
  if [ -f /run/secrets/build_ca ]; then install -m 644 /run/secrets/build_ca /tmp/build-ca.pem && echo 'Acquire::https::CAInfo "/tmp/build-ca.pem";' > /etc/apt/apt.conf.d/99build-ca; fi; \
  apt-get update && apt-get install -y --no-install-recommends python3-venv postgresql-client \
  && rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99build-ca /tmp/build-ca.pem
COPY python/requirements.txt /tmp/requirements.txt
RUN --mount=type=secret,id=build_ca,required=false \
  if [ -f /run/secrets/build_ca ]; then export PIP_CERT=/run/secrets/build_ca; fi; \
  python3 -m venv /opt/pdf && /opt/pdf/bin/pip install --no-cache-dir -r /tmp/requirements.txt
COPY package.json pnpm-lock.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=secret,id=build_ca,required=false \
  if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
  npm install -g pnpm@${PNPM_VERSION} && pnpm install --frozen-lockfile
COPY --chown=pwuser:pwuser . .
RUN mkdir -p /data/storage && chown pwuser:pwuser /data/storage
USER pwuser
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/worker/index.ts"]
