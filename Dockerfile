# ----------------------------------------
# Base Stage
# ----------------------------------------
FROM node:24.14.0-alpine3.22 AS base

RUN mkdir /app
WORKDIR /app

ENV NODE_ENV="production"

# Install `pnpm`.
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN mkdir $PNPM_HOME && \
        wget -qO- "https://github.com/pnpm/pnpm/releases/download/v10.33.4/pnpm-linuxstatic-arm64" > "$PNPM_HOME/pnpm" && \
        chmod +x $PNPM_HOME/pnpm && \
        ln -s $PNPM_HOME/pnpm /usr/local/bin/pnpm

# ----------------------------------------
# Build Stage
# ----------------------------------------
FROM base AS build

# Skip `postinstall` script of `@prisma/client` during installation.
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true

# Fetch all dependencies into the virtual store.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches

RUN pnpm fetch

COPY . .

# Install dependencies.
RUN pnpm install --offline

# Generate database client.
RUN pnpm db:generate

# Build the app.
RUN pnpm build

# ----------------------------------------
# Production Dependencies Stage
# ----------------------------------------
# Drop the dev dependency tree, then reinstall production-only. This runs in its
# own stage so the `migrate` stage can still copy the dev tree from `build`.
FROM build AS prod-deps

RUN find . -type d -name "node_modules" -prune -exec rm -rf {} +
RUN pnpm install --offline --prod

# ----------------------------------------
# Runtime Base Stage
# ----------------------------------------
FROM base AS runtime

RUN apk add --no-cache ca-certificates

# Download SSL certificate bundle.
RUN wget https://truststore.pki.rds.amazonaws.com/ap-southeast-1/ap-southeast-1-bundle.pem -O /etc/ssl/certs/rds-ca-bundle.pem

# 1. Create a new user named `zero`.
# 2. Change the permission of `app` folder to user `zero`.
# 3. Change the current user from `root` to `zero`.
RUN addgroup -S zero && \
        adduser -S zero -G zero && \
        chown zero:zero /app

USER zero

# ----------------------------------------
# Migrate Stage
# ----------------------------------------
# Applies pending database migrations, then exits. Run as a one-off ECS task.
#
# This stage carries the dev dependency tree on purpose. The Prisma CLI,
# `dotenv`, and `typescript` are all dev dependencies, and `prisma.config.ts`
# needs all three. `prisma/schema.prisma` declares no datasource `url`, so that
# config file is the only source of `POSTGRES_URL`.
#
# The CMD calls the pnpm shim directly. The shim sets `NODE_PATH` for the pnpm
# store, then runs `exec`, so exactly one Node process starts.
FROM runtime AS migrate

COPY --from=build --chown=zero:zero /app/package.json ./package.json
COPY --from=build --chown=zero:zero /app/node_modules ./node_modules
COPY --from=build --chown=zero:zero /app/prisma ./prisma
COPY --from=build --chown=zero:zero /app/prisma.config.ts ./prisma.config.ts

CMD ["/app/node_modules/.bin/prisma", "migrate", "deploy"]

# ----------------------------------------
# Production Stage
# ----------------------------------------
# Keep this stage last. A build with no `--target` must still produce it.
FROM runtime AS production

COPY --from=prod-deps --chown=zero:zero /app/package.json ./package.json
COPY --from=prod-deps --chown=zero:zero /app/node_modules ./node_modules
COPY --from=prod-deps --chown=zero:zero /app/build ./build
COPY --from=prod-deps --chown=zero:zero /app/prisma ./prisma
COPY --from=prod-deps --chown=zero:zero /app/prisma.config.ts ./prisma.config.ts

EXPOSE 3000

CMD ["node", "build/index.js"]
