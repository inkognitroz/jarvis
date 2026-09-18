#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export JARVIS_ALLOW_WRITES=0
export JARVIS_EFFORT="${JARVIS_EFFORT:-medium}"
exec npm start
