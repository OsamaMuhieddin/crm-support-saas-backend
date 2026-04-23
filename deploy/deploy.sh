#!/usr/bin/env bash
set -euo pipefail

# Rollback-safe note:
# This script deploys the immutable APP_IMAGE tag passed in by CI.
# If a new deploy is bad, rerun the script with the previous APP_IMAGE
# value recorded in deploy-history.log.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.azure.yml}"
APP_ENV_FILE="${APP_ENV_FILE:-$ROOT_DIR/.env.azure}"
DEPLOY_HISTORY_FILE="${DEPLOY_HISTORY_FILE:-$ROOT_DIR/deploy-history.log}"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Missing compose file: $COMPOSE_FILE" >&2
  exit 1
fi

if [[ ! -f "$APP_ENV_FILE" ]]; then
  echo "Missing env file: $APP_ENV_FILE" >&2
  exit 1
fi

if [[ -z "${APP_IMAGE:-}" ]]; then
  echo "APP_IMAGE is required." >&2
  exit 1
fi

DEPLOY_APP_IMAGE="$APP_IMAGE"

set -a
source "$APP_ENV_FILE"
set +a

APP_IMAGE="$DEPLOY_APP_IMAGE"

if [[ -n "${GHCR_USERNAME:-}" && -n "${GHCR_TOKEN:-}" ]]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
fi

mkdir -p "$(dirname "$DEPLOY_HISTORY_FILE")"

PREVIOUS_IMAGE="$(docker compose -f "$COMPOSE_FILE" --env-file "$APP_ENV_FILE" ps -q api 2>/dev/null | xargs -r docker inspect --format='{{.Config.Image}}' 2>/dev/null || true)"

echo "Deploying image: $APP_IMAGE"
if [[ -n "$PREVIOUS_IMAGE" ]]; then
  echo "Previous API image: $PREVIOUS_IMAGE"
fi

docker compose -f "$COMPOSE_FILE" --env-file "$APP_ENV_FILE" pull api billing-worker
docker compose -f "$COMPOSE_FILE" --env-file "$APP_ENV_FILE" up -d

echo "$(date -Iseconds) APP_IMAGE=$APP_IMAGE PREVIOUS_IMAGE=${PREVIOUS_IMAGE:-none}" >> "$DEPLOY_HISTORY_FILE"

SMOKE_BASE_URL="${APP_BASE_URL:-}"
if [[ -z "$SMOKE_BASE_URL" ]]; then
  echo "APP_BASE_URL must be set in $APP_ENV_FILE for smoke verification." >&2
  exit 1
fi

SMOKE_URL="${SMOKE_BASE_URL%/}/api/health"
echo "Running smoke check: $SMOKE_URL"
curl --fail --silent --show-error --retry 10 --retry-delay 5 "$SMOKE_URL" >/dev/null

echo "Deployment succeeded."
