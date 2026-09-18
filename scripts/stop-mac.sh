#!/usr/bin/env bash
set -euo pipefail
for port in 5173 8787; do
  pids="$(lsof -ti tcp:$port 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "Stopping JARVIS process(es) on port $port: $pids"
    kill $pids || true
  fi
done
