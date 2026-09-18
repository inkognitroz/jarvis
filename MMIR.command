#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
if ! command -v node >/dev/null; then
  echo 'Node.js is not on PATH. Start npm run start:mmir from your normal Terminal.'
  read -r -p 'Press Enter to close. '
  exit 1
fi
node scripts/start-mmir.mjs --open
