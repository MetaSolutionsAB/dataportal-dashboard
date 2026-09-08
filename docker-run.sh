#!/bin/sh
# Kör installation eller generator i standardimagen node:22-alpine utan att
# behöva Docker Compose. Motsvarar tjänsterna i docker-compose.yml.
#
#   ./docker-run.sh install                      # pnpm install i containern
#   ./docker-run.sh generate                     # skriver public/status.json
#   ./docker-run.sh generate --config x.json     # extra flaggor skickas vidare
#
# Miljövariabler:
#   EXPORTS_DIR  katalog på värden med exportfilerna (standard /srv/exports),
#                monteras som /data/exports i containern
#   NODE_IMAGE   image att köra i (standard node:22-alpine)
set -eu

cd "$(dirname "$0")"
EXPORTS_DIR="${EXPORTS_DIR:-/srv/exports}"
NODE_IMAGE="${NODE_IMAGE:-node:22-alpine}"

cmd="${1:-}"
[ $# -gt 0 ] && shift

run() {
  docker run --rm \
    -v "$PWD:/app" \
    -v "$EXPORTS_DIR:/data/exports:ro" \
    -w /app \
    -e CI=true \
    -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    "$NODE_IMAGE" "$@"
}

case "$cmd" in
  install)
    run sh -c "corepack enable && pnpm install --prod --frozen-lockfile"
    ;;
  generate)
    if [ $# -eq 0 ]; then set -- --config config.json; fi
    run node bin/generate.js "$@"
    ;;
  *)
    echo "Användning: $0 install | generate [flaggor till bin/generate.js]" >&2
    exit 2
    ;;
esac
