# ----------------------------------------
# Base Stage
# ----------------------------------------
FROM node:24.14.0-alpine3.22 AS base

RUN mkdir /app
WORKDIR /app

ENV NODE_ENV="production"

# Install `pnpm`.
#
# The download goes to a temporary name first. `sha256sum -c` verifies it before
# `chmod +x` makes it executable, so the build never runs an unverified binary.
# BusyBox `wget` exits non-zero on an HTTP error and writes no file, so `&&`
# stops the chain. The checksum covers the other case: an error page served with
# status 200.
#
# The version must match `packageManager` in `package.json`. To refresh the
# checksum after a version bump, run this on your machine:
#
#   curl -fsSL https://github.com/pnpm/pnpm/releases/download/v<version>/pnpm-linuxstatic-arm64 | sha256sum
#
# Then cross-check the value against the digest GitHub reports for the asset:
#
#   gh api repos/pnpm/pnpm/releases/tags/v<version> \
#     --jq '.assets[] | select(.name == "pnpm-linuxstatic-arm64") | .digest'
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN mkdir $PNPM_HOME && \
        wget -q -O "$PNPM_HOME/pnpm.download" "https://github.com/pnpm/pnpm/releases/download/v10.33.4/pnpm-linuxstatic-arm64" && \
        echo "925a56d3e23672d8070ff5fb23b34ffc5cc592257e0d59c0bf3599d98d878b56  $PNPM_HOME/pnpm.download" | sha256sum -c - && \
        mv "$PNPM_HOME/pnpm.download" "$PNPM_HOME/pnpm" && \
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
#
# The download goes to `/tmp` first. `sha256sum -c` verifies it before it reaches
# the trust store directory. A substituted bundle would change which TLS
# certificates the app accepts for its database connection.
#
# AWS rotates this bundle. A rotation fails the build on the checksum, which is
# deliberate: read the new bundle, then pin it. To read it, run this on your
# machine:
#
#   curl -fsSL https://truststore.pki.rds.amazonaws.com/ap-southeast-1/ap-southeast-1-bundle.pem -o bundle.pem
#   openssl crl2pkcs7 -nocrl -certfile bundle.pem | openssl pkcs7 -print_certs -noout
#
# To refresh the checksum, run:
#
#   sha256sum bundle.pem
#
# The pinned bundle holds 3 certificates for `ap-southeast-1`.
RUN wget -q -O /tmp/rds-ca-bundle.pem https://truststore.pki.rds.amazonaws.com/ap-southeast-1/ap-southeast-1-bundle.pem && \
        echo "3c696020a3b7c6721085d182211c28024ab01873ade35dcc7eeebb89c20ee979  /tmp/rds-ca-bundle.pem" | sha256sum -c - && \
        mv /tmp/rds-ca-bundle.pem /etc/ssl/certs/rds-ca-bundle.pem

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
