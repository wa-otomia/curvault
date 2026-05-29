#!/usr/bin/env bash
# Run frontend (tsc) + backend (cargo check) validations the same way CI does,
# inside Docker containers. No host JDK/Node/Rust required.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Frontend: tsc"
docker run --rm -v "$PWD:/work" -w /work node:20-bookworm-slim bash -c '
    npm install --no-audit --no-fund --silent
    npx tsc --noEmit
'

echo
echo "==> Backend: cargo check"
docker run --rm -v "$PWD:/work" -w /work/src-tauri rust:bookworm bash -c '
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev libsoup-3.0-dev \
        libayatana-appindicator3-dev libsecret-1-dev libpcsclite-dev patchelf > /dev/null
    cargo check --all-targets
'

echo
echo "All checks passed."
