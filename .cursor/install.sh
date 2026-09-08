#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for Exoframe.
#
# Exoframe requires Node.js >= 22.18 (package.json "engines"): the test script
# is `node --test` over TypeScript files, and native type-stripping of `.ts`
# is only unflagged in Node >= 22.18. The Cloud Agent base image, however,
# ships an exec-daemon Node shim at /exec-daemon/node (v22.14) that sits ahead
# of nvm on PATH for every command the agent runs, so simply setting an nvm
# default is not enough — the shim keeps winning.
#
# Fix: install Node 22 via the preinstalled nvm, then expose its node/npm/npx
# from /usr/local/cargo/bin, which the base image places FIRST on PATH (before
# /exec-daemon) for both plain and login shells. That makes the required Node
# the effective `node` for all agent and user commands.
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "nvm is not available at $NVM_DIR; cannot provision Node.js >= 22.18" >&2
  exit 1
fi

# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

# Install (no-op if already present) and make Node 22 the nvm default.
nvm install 22
nvm alias default 22
nvm use default

# Resolve the concrete bin dir for the default Node (tracks whatever 22.x nvm
# installed) and shim the toolchain into the first PATH entry so it beats the
# /exec-daemon/node shim for every command.
NODE_BIN_DIR="$(dirname "$(nvm which default)")"
SHIM_DIR="/usr/local/cargo/bin"

if [ -d "$SHIM_DIR" ] && [ -w "$SHIM_DIR" ]; then
  for tool in node npm npx corepack; do
    if [ -x "$NODE_BIN_DIR/$tool" ]; then
      ln -sfn "$NODE_BIN_DIR/$tool" "$SHIM_DIR/$tool"
    fi
  done
else
  echo "Warning: $SHIM_DIR is not writable; relying on nvm PATH only." >&2
fi

echo "Using node: $(command -v node) -> $(node --version)"
echo "Using npm:  $(command -v npm) -> $(npm --version)"

# Reproducible dependency install from the committed lockfile.
npm ci

# Build the CLI so `node dist/bin.js` (the `exoframe` bin) works immediately.
npm run build
