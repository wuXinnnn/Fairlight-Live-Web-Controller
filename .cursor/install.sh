#!/usr/bin/env bash
# Cursor cloud agent install script. Runs from the repository root on every
# Build, so it must be idempotent. Prepares Node.js >= 22 and pnpm (version
# pinned by the "packageManager" field in package.json), then installs
# dependencies and warms the build cache.
set -euo pipefail

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -p 'process.versions.node.split(".")[0]'
}

# The project requires Node >= 22 (see "engines" in package.json).
if [ "$(node_major)" -lt 22 ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  fi
  # nvm is a shell function, not a binary.
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install 22
  nvm alias default 22
fi

# Activate the pnpm version pinned in package.json via corepack; fall back to
# a global install when corepack is unavailable.
if command -v corepack >/dev/null 2>&1; then
  corepack enable
  corepack install
else
  npm install -g pnpm@11
fi

pnpm install --frozen-lockfile
pnpm build
