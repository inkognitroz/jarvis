#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { echo 'This installer is for macOS.' >&2; exit 1; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
command -v node >/dev/null || { echo 'Install a supported Node.js LTS release first.' >&2; exit 1; }
node -e 'const [m,n]=process.versions.node.split(".").map(Number); if (!(m===20&&n>=19||m===22&&n>=12||m>=24)) process.exit(1)' || { echo 'Use Node 22.12+ or a newer supported LTS release.' >&2; exit 1; }
npm ci
npm run test:mmir
npm run build
npm run lint
printf '\nInstalled and checked. Start with: npm run start:mmir -- --open\n'
printf 'Claude Code, Anthropic login and ElevenLabs are not required for MMIR mode.\n'
