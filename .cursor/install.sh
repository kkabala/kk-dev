#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for Exoframe.
# Exoframe requires Node.js >= 22.18 (package.json "engines"). The base image's
# default node predates that, so select a compatible Node 22 via the
# preinstalled nvm, then install dependencies and build the CLI.
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "nvm is not available at $NVM_DIR; cannot provision Node.js >= 22.18" >&2
  exit 1
fi

# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

# Install (no-op if already present) and make Node 22 the default for every
# future login shell. nvm prepends its bin dir to PATH, so this node wins.
nvm install 22
nvm alias default 22
nvm use default

node --version
npm --version

# Reproducible dependency install from the committed lockfile.
npm ci

# Build the CLI so `node dist/bin.js` (the `exoframe` bin) works immediately.
npm run build
