#!/usr/bin/env bash
set -euo pipefail

echo "J.A.R.V.I.S. — Mac setup"
echo

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: This installer is intended for macOS." >&2
  exit 1
fi

echo "macOS: $(sw_vers -productVersion)"
echo "Arch:  $(uname -m)"

for cmd in git node npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: '$cmd' is missing." >&2
    exit 1
  fi
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 20 )); then
  echo "ERROR: Node.js 20+ is required. Found $(node -v)." >&2
  exit 1
fi

echo "Node: $(node -v)"
echo "npm:  $(npm -v)"
echo "git:  $(git --version)"

if command -v claude >/dev/null 2>&1; then
  echo "Claude Code: $(claude --version 2>/dev/null || true)"
else
  echo "WARNING: Claude Code is not installed or not on PATH."
  echo "Install it using Anthropic's official installer, then run 'claude' once to log in."
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo
echo "Installing locked dependencies..."
npm ci

echo
echo "Running project setup checks..."
npm run setup

echo
echo "Building..."
npm run build

echo
echo "Linting..."
npm run lint

echo
echo "Setup checks completed successfully."
echo "Start JARVIS with:"
echo "  cd \"$ROOT\""
echo "  JARVIS_ALLOW_WRITES=0 npm start"
echo
echo "Then open http://localhost:5173 in Chrome or Edge, click INITIALISE,"
echo "allow microphone access, and say: Hey Jarvis"
