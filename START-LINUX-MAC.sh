#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f .env ]]; then cp .env.example .env; fi
if [[ ! -f dist/server.js ]]; then npm install && npm run build; fi
echo 'Abre: http://127.0.0.1:8765'
node dist/server.js
