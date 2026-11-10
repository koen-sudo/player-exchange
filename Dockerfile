# One image for the online demo (web and worker). Railway or any container
# host runs it twice with a different start command: `deploy/start.sh web`
# and `deploy/start.sh worker`. Not a production image (see docs/13-handover.md).
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# The build needs a valid configuration; the real values come at runtime.
RUN set -a && . ./.env.example && set +a && NEXT_TELEMETRY_DISABLED=1 pnpm build

ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
CMD ["bash", "deploy/start.sh", "web"]
