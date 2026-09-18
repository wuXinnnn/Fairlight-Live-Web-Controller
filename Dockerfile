# syntax=docker/dockerfile:1

# --- base --------------------------------------------------------------------------------------
# git is for emberplus-connection@0.3.1, whose asn1 dependency is hosted on GitHub rather than on
# the registry. Only the two build stages need it; the runtime stage does not.
FROM node:22-alpine AS base
RUN apk add --no-cache git
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

# --- build -------------------------------------------------------------------------------------
# The whole workspace, devDependencies included: the build runs tsc and vite.
FROM base AS build

# The lockfile alone is enough to fill the virtual store, so the slow layer -- fetching every
# package -- is rebuilt only when the lockfile changes rather than on every source edit. Copying
# the manifests and installing instead would not work here: a workspace install runs each
# project's prepare script, and packages/shared and packages/test-utils both run tsc, which needs
# sources that have not been copied yet.
COPY pnpm-lock.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm build

# --- deps --------------------------------------------------------------------------------------
# The production dependency tree, built in a stage of its own.
#
# Pruning the build stage with `pnpm install --prod` does not work: it unlinks the
# devDependencies from each project's node_modules but leaves the packages themselves sitting in
# node_modules/.pnpm, which `pnpm fetch` had already filled with the whole lockfile. Half a
# gigabyte of vite, vitest, eslint and typescript would ride along into the image. `pnpm prune
# --prod` is no better: it is not workspace recursive, so at the root it prunes the root manifest
# and leaves apps/server/node_modules untouched.
#
# `pnpm fetch --prod` fills the store with the production closure and nothing else, so there is
# nothing to prune afterwards. --ignore-scripts because the prepare scripts of packages/shared
# and packages/test-utils run tsc, which is a devDependency and by design not here; their output
# is copied from the build stage instead. CI=true lets pnpm rebuild node_modules without asking a
# terminal that is not there.
FROM base AS deps
COPY pnpm-lock.yaml ./
RUN pnpm fetch --prod

COPY package.json pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/test-utils/package.json packages/test-utils/
RUN CI=true pnpm install --prod --frozen-lockfile --offline --ignore-scripts

# --- runtime -----------------------------------------------------------------------------------
# No git, no pnpm, no sources, no devDependencies. The layout mirrors the repository, which is
# what keeps two separate sets of relative lookups valid: the symlinks pnpm writes into
# node_modules, and the paths apps/server/src/paths.ts resolves from its own location.
FROM node:22-alpine AS runtime
WORKDIR /app

COPY --from=deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/package.json ./apps/server/package.json
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/packages/shared/package.json ./packages/shared/package.json
# zod is resolved from here, not from apps/server/node_modules.
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist

# apps/server/dist/tools is kept whole. It is not all developer tooling: ember-service.js imports
# expand-ember-tree.js from it, so deleting the directory takes the server down with it. The
# drivers in there that do import a devDependency this image lacks are never reached from
# main.js, so their imports are never resolved.

# Before VOLUME: Docker initialises a fresh named volume from this directory's content and its
# ownership, and the node user has to be able to write config.json into it.
RUN mkdir -p /app/data && chown -R node:node /app/data

LABEL org.opencontainers.image.source="https://github.com/wuXinnnn/Fairlight-Live-Web-Controller" \
      org.opencontainers.image.description="Web remote controller for Blackmagic Design Fairlight Live" \
      org.opencontainers.image.licenses="MIT"

USER node
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/main.js"]
