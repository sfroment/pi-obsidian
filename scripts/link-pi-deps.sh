#!/usr/bin/env bash
# Link pi runtime packages into local node_modules so `bun test` can resolve
# `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `typebox`.
#
# These packages are provided by the pi agent runtime at load time and are
# declared as devDependencies for type resolution. When `bun install` has
# installed them (e.g. in CI), they resolve normally and this script is a no-op.
# Locally, where pi is installed globally but not in this repo's node_modules,
# this symlinks the global copies in.
set -euo pipefail
cd "$(dirname "$0")/.."

# If the packages are already installed in node_modules (e.g. via `bun install`
# in CI), nothing to do. We check the directory directly because the pi
# package's exports map blocks `require.resolve` from Node CJS.
if [ -d "node_modules/@earendil-works/pi-coding-agent" ]; then
  echo "pi runtime packages already installed, skipping symlinks"
  exit 0
fi

# Locate the pi-coding-agent install. Resolution order:
#   1. PI_RUNTIME_DIR env var — explicit override (the directory that contains
#      node_modules, e.g. a custom runtime root).
#   2. The active node global (`npm root -g`).
PI_DIR=""
if [ -n "${PI_RUNTIME_DIR:-}" ]; then
  for candidate in \
    "$PI_RUNTIME_DIR/node_modules/@earendil-works/pi-coding-agent" \
    "$PI_RUNTIME_DIR/@earendil-works/pi-coding-agent"; do
    if [ -d "$candidate/dist" ]; then
      PI_DIR="$candidate"
      break
    fi
  done
fi
if [ -z "$PI_DIR" ]; then
  candidate="$(npm root -g 2>/dev/null)/@earendil-works/pi-coding-agent"
  if [ -d "$candidate/dist" ]; then
    PI_DIR="$candidate"
  fi
fi

if [ -z "$PI_DIR" ]; then
  echo "Could not locate @earendil-works/pi-coding-agent." >&2
  echo "Run 'bun install' first, or set PI_RUNTIME_DIR to the directory containing the pi runtime's node_modules." >&2
  exit 1
fi

mkdir -p node_modules/@earendil-works
ln -sfn "$PI_DIR" node_modules/@earendil-works/pi-coding-agent
ln -sfn "$PI_DIR/node_modules/@earendil-works/pi-ai" node_modules/@earendil-works/pi-ai
ln -sfn "$PI_DIR/node_modules/typebox" node_modules/typebox
echo "Linked pi runtime packages from $PI_DIR"
